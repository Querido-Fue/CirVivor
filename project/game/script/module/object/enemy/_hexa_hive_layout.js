const HEXA_HIVE_LAYOUT_SCHEMA_VERSION = 1;
const HEXA_HIVE_TYPE = 'hexa_hive';
const HEXA_NORMALIZED_RADIUS = 0.47;
const HEXA_HIVE_FRONT_RENDER_SCALE = 0.9;
const HEXA_HIVE_BACKDROP_RENDER_SCALE = 1.14;
const HEXA_HIVE_OUTLINE_THICKNESS_RATIO = 0.12;
const COLLISION_PART_MERGE_AREA_EPSILON = 1e-4;
const EPSILON = 1e-6;
const VERTEX_KEY_SCALE = 10000;
const HEXA_AXIAL_DIRECTIONS = Object.freeze([
    Object.freeze({ q: 1, r: 0 }),
    Object.freeze({ q: 1, r: -1 }),
    Object.freeze({ q: 0, r: -1 }),
    Object.freeze({ q: -1, r: 0 }),
    Object.freeze({ q: -1, r: 1 }),
    Object.freeze({ q: 0, r: 1 })
]);
const HEXA_EXPOSED_EDGE_DIRECTIONS = Object.freeze([
    Object.freeze({ q: 1, r: -1 }),
    Object.freeze({ q: 1, r: 0 }),
    Object.freeze({ q: 0, r: 1 }),
    Object.freeze({ q: -1, r: 1 }),
    Object.freeze({ q: -1, r: 0 }),
    Object.freeze({ q: 0, r: -1 })
]);
const HEXA_LOCAL_VERTICES = Object.freeze([
    Object.freeze({ x: 0, y: -HEXA_NORMALIZED_RADIUS }),
    Object.freeze({
        x: Math.cos(-Math.PI / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin(-Math.PI / 6) * HEXA_NORMALIZED_RADIUS
    }),
    Object.freeze({
        x: Math.cos(Math.PI / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin(Math.PI / 6) * HEXA_NORMALIZED_RADIUS
    }),
    Object.freeze({ x: 0, y: HEXA_NORMALIZED_RADIUS }),
    Object.freeze({
        x: Math.cos((5 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin((5 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS
    }),
    Object.freeze({
        x: Math.cos((7 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS,
        y: Math.sin((7 * Math.PI) / 6) * HEXA_NORMALIZED_RADIUS
    })
]);
const HEXA_SINGLE_CELL_AREA = Math.abs(getPolygonSignedArea(HEXA_LOCAL_VERTICES));
const HEXA_BOUNDARY_NOTCH_EDGE_LENGTH = HEXA_NORMALIZED_RADIUS;
const HEXA_BOUNDARY_NOTCH_EDGE_TOLERANCE = 1e-4;
const HEXA_BOUNDARY_NOTCH_AREA = HEXA_SINGLE_CELL_AREA / 6;
const HEXA_BOUNDARY_NOTCH_AREA_TOLERANCE = 1e-4;
const HEXA_BOUNDARY_NOTCH_SIMPLIFY_MAX_PASSES = 128;
/**
 * 육각형 합체 적 타입 문자열입니다.
 * @returns {string}
 */
export function getHexaHiveType() {
    return HEXA_HIVE_TYPE;
}

/**
 * 육각형 합체 레이아웃 스키마 버전입니다.
 * @returns {number}
 */
export function getHexaHiveLayoutSchemaVersion() {
    return HEXA_HIVE_LAYOUT_SCHEMA_VERSION;
}

/**
 * 육각형 기본 반지름 비율입니다.
 * @returns {number}
 */
export function getHexaNormalizedRadius() {
    return HEXA_NORMALIZED_RADIUS;
}

/**
 * 합체 적 전경 조각 렌더 스케일입니다.
 * @returns {number}
 */
export function getHexaHiveFrontRenderScale() {
    return HEXA_HIVE_FRONT_RENDER_SCALE;
}

/**
 * 합체 적 배경 실루엣 렌더 스케일입니다.
 * @returns {number}
 */
export function getHexaHiveBackdropRenderScale() {
    return HEXA_HIVE_BACKDROP_RENDER_SCALE;
}

/**
 * 합체 적 외곽선 두께 비율입니다.
 * @returns {number}
 */
export function getHexaHiveOutlineThicknessRatio() {
    return HEXA_HIVE_OUTLINE_THICKNESS_RATIO;
}

/**
 * 육각형 격자 대칭(60도) 기준으로 회전 각도를 스냅합니다.
 * @param {number|null|undefined} rotationDeg
 * @returns {number}
 */
export function snapHexaRotationDegToSymmetry(rotationDeg) {
    const normalized = normalizeDegrees(rotationDeg);
    return normalizeDegrees(Math.round(normalized / 60) * 60);
}

/**
 * 대상 타입이 육각형 합체 파이프라인 대상인지 반환합니다.
 * @param {string|null|undefined} enemyType
 * @returns {boolean}
 */
export function isHexaMergeEnemyType(enemyType) {
    return enemyType === 'hexa' || enemyType === HEXA_HIVE_TYPE;
}

/**
 * 레이아웃용 axial 셀 키를 생성합니다.
 * @param {number} q
 * @param {number} r
 * @returns {string}
 */
function buildHexaCellKey(q, r) {
    return `${q},${r}`;
}

/**
 * 정점 좌표를 문자열 키로 정규화합니다.
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function buildVertexKey(x, y) {
    return `${Math.round(x * VERTEX_KEY_SCALE)},${Math.round(y * VERTEX_KEY_SCALE)}`;
}

/**
 * 각도를 라디안으로 변환합니다.
 * @param {number} degrees
 * @returns {number}
 */
function toRadians(degrees) {
    return (Number.isFinite(degrees) ? degrees : 0) * (Math.PI / 180);
}

/**
 * 각도를 -180~180 범위로 정규화합니다.
 * @param {number} degrees
 * @returns {number}
 */
function normalizeDegrees(degrees) {
    if (!Number.isFinite(degrees)) {
        return 0;
    }

    let normalized = degrees % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized < -180) normalized += 360;
    return normalized;
}

/**
 * 벡터를 회전합니다.
 * @param {number} x
 * @param {number} y
 * @param {number} radians
 * @returns {{x: number, y: number}}
 */
function rotatePoint(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos)
    };
}

/**
 * pointy-top axial 좌표를 로컬 좌표로 변환합니다.
 * @param {number} q
 * @param {number} r
 * @returns {{x: number, y: number}}
 */
function axialToLocalPoint(q, r) {
    return {
        x: HEXA_NORMALIZED_RADIUS * Math.sqrt(3) * (q + (r * 0.5)),
        y: HEXA_NORMALIZED_RADIUS * 1.5 * r
    };
}

/**
 * 로컬 좌표를 axial float 좌표로 변환합니다.
 * @param {number} x
 * @param {number} y
 * @returns {{q: number, r: number}}
 */
function localPointToAxial(x, y) {
    const safeRadius = Math.max(EPSILON, HEXA_NORMALIZED_RADIUS);
    return {
        q: ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / safeRadius,
        r: ((2 / 3) * y) / safeRadius
    };
}

/**
 * axial float 좌표를 최근접 정수 셀로 반올림합니다.
 * @param {number} q
 * @param {number} r
 * @returns {{q: number, r: number}}
 */
function roundAxialCell(q, r) {
    const x = Number.isFinite(q) ? q : 0;
    const z = Number.isFinite(r) ? r : 0;
    const y = -x - z;

    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);

    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);

    if (dx > dy && dx > dz) {
        rx = -ry - rz;
    } else if (dy > dz) {
        ry = -rx - rz;
    } else {
        rz = -rx - ry;
    }

    return { q: rx, r: rz };
}

/**
 * 셀 배열을 로컬 중심 좌표 배열로 변환합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{x: number, y: number}[]}
 */
function buildLocalCentersFromCells(cells) {
    const centers = [];
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell) {
            continue;
        }

        const point = axialToLocalPoint(cell.q, cell.r);
        centers.push({ x: point.x, y: point.y });
    }
    return centers;
}

/**
 * 셀 배열을 키 기반 고유 맵으로 정규화합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {Map<string, {q: number, r: number}>}
 */
function buildUniqueHexaCellMap(cells) {
    const uniqueMap = new Map();
    if (!Array.isArray(cells)) {
        return uniqueMap;
    }

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell || !Number.isInteger(cell.q) || !Number.isInteger(cell.r)) {
            continue;
        }

        uniqueMap.set(buildHexaCellKey(cell.q, cell.r), {
            q: cell.q,
            r: cell.r
        });
    }

    return uniqueMap;
}

/**
 * 셀 집합을 연결 컴포넌트 배열로 분리합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{q: number, r: number}[][]}
 */
function buildHexaCellConnectedComponents(cells) {
    const uniqueMap = buildUniqueHexaCellMap(cells);
    if (uniqueMap.size === 0) {
        return [];
    }

    const visited = new Set();
    const components = [];
    for (const [cellKey, cell] of uniqueMap.entries()) {
        if (visited.has(cellKey)) {
            continue;
        }

        const queue = [cell];
        const component = [];
        visited.add(cellKey);
        while (queue.length > 0) {
            const current = queue.shift();
            component.push(current);

            for (let i = 0; i < HEXA_AXIAL_DIRECTIONS.length; i++) {
                const neighborKey = buildHexaCellKey(
                    current.q + HEXA_AXIAL_DIRECTIONS[i].q,
                    current.r + HEXA_AXIAL_DIRECTIONS[i].r
                );
                if (visited.has(neighborKey) || !uniqueMap.has(neighborKey)) {
                    continue;
                }

                visited.add(neighborKey);
                queue.push(uniqueMap.get(neighborKey));
            }
        }

        components.push(component);
    }

    return components;
}

/**
 * 컴포넌트 전체를 axial offset만큼 이동합니다.
 * @param {{q: number, r: number}[]} cells
 * @param {number} dq
 * @param {number} dr
 * @returns {{q: number, r: number}[]}
 */
function shiftHexaCells(cells, dq, dr) {
    const safeDQ = Number.isInteger(dq) ? dq : 0;
    const safeDR = Number.isInteger(dr) ? dr : 0;
    return cells.map((cell) => ({
        q: cell.q + safeDQ,
        r: cell.r + safeDR
    }));
}

/**
 * 기준 셀 집합에 컴포넌트를 가장 적게 이동해 붙이는 offset을 찾습니다.
 * @param {{q: number, r: number}[]} baseCells
 * @param {{q: number, r: number}[]} componentCells
 * @returns {{dq: number, dr: number, score: number}|null}
 */
function findBestHexaComponentAttachment(baseCells, componentCells) {
    if (!Array.isArray(baseCells) || baseCells.length === 0 || !Array.isArray(componentCells) || componentCells.length === 0) {
        return null;
    }

    const occupied = buildUniqueHexaCellMap(baseCells);
    let bestCandidate = null;
    for (let i = 0; i < baseCells.length; i++) {
        const baseCell = baseCells[i];
        for (let j = 0; j < componentCells.length; j++) {
            const componentCell = componentCells[j];
            for (let directionIndex = 0; directionIndex < HEXA_AXIAL_DIRECTIONS.length; directionIndex++) {
                const direction = HEXA_AXIAL_DIRECTIONS[directionIndex];
                const dq = (baseCell.q + direction.q) - componentCell.q;
                const dr = (baseCell.r + direction.r) - componentCell.r;
                let overlapped = false;
                for (let cellIndex = 0; cellIndex < componentCells.length; cellIndex++) {
                    const shiftedQ = componentCells[cellIndex].q + dq;
                    const shiftedR = componentCells[cellIndex].r + dr;
                    if (occupied.has(buildHexaCellKey(shiftedQ, shiftedR))) {
                        overlapped = true;
                        break;
                    }
                }
                if (overlapped) {
                    continue;
                }

                const shiftPoint = axialToLocalPoint(dq, dr);
                const score = (shiftPoint.x * shiftPoint.x) + (shiftPoint.y * shiftPoint.y);
                if (!bestCandidate || score < bestCandidate.score) {
                    bestCandidate = { dq, dr, score };
                }
            }
        }
    }

    return bestCandidate;
}

/**
 * 스냅 결과가 분리된 경우, 컴포넌트 단위로 재배치해 하나의 연결 구조로 보정합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{q: number, r: number}[]}
 */
function connectDetachedHexaCellComponents(cells) {
    const components = buildHexaCellConnectedComponents(cells);
    if (components.length <= 1) {
        return [...buildUniqueHexaCellMap(cells).values()];
    }

    components.sort((left, right) => right.length - left.length);
    let connectedCells = [...components.shift()];

    while (components.length > 0) {
        let bestComponentIndex = -1;
        let bestAttachment = null;
        for (let i = 0; i < components.length; i++) {
            const attachment = findBestHexaComponentAttachment(connectedCells, components[i]);
            if (!attachment) {
                continue;
            }

            if (!bestAttachment || attachment.score < bestAttachment.score) {
                bestAttachment = attachment;
                bestComponentIndex = i;
            }
        }

        if (bestComponentIndex < 0 || !bestAttachment) {
            for (let i = 0; i < components.length; i++) {
                connectedCells = connectedCells.concat(components[i]);
            }
            break;
        }

        const shiftedComponent = shiftHexaCells(
            components[bestComponentIndex],
            bestAttachment.dq,
            bestAttachment.dr
        );
        connectedCells = connectedCells.concat(shiftedComponent);
        components.splice(bestComponentIndex, 1);
    }

    return [...buildUniqueHexaCellMap(connectedCells).values()];
}

/**
 * 로컬 좌표 배열 전체에 동일한 평행 이동을 적용합니다.
 * @param {{x: number, y: number}[]} points
 * @param {number} offsetX
 * @param {number} offsetY
 * @returns {{x: number, y: number}[]}
 */
function offsetLocalPoints(points, offsetX, offsetY) {
    if (!Array.isArray(points) || points.length === 0) {
        return [];
    }

    const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
    const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
    return points.map((point) => ({
        x: (Number.isFinite(point?.x) ? point.x : 0) + safeOffsetX,
        y: (Number.isFinite(point?.y) ? point.y : 0) + safeOffsetY
    }));
}

/**
 * collision part 좌표 전체에 동일한 평행 이동을 적용합니다.
 * @param {number[][]} parts
 * @param {number} offsetX
 * @param {number} offsetY
 * @returns {number[][]}
 */
function offsetCollisionParts(parts, offsetX, offsetY) {
    if (!Array.isArray(parts) || parts.length === 0) {
        return [];
    }

    const safeOffsetX = Number.isFinite(offsetX) ? offsetX : 0;
    const safeOffsetY = Number.isFinite(offsetY) ? offsetY : 0;
    return parts.map((part) => {
        if (!Array.isArray(part) || part.length === 0) {
            return [];
        }

        const shifted = new Array(part.length);
        for (let i = 0; i < part.length; i += 2) {
            shifted[i] = (Number.isFinite(part[i]) ? part[i] : 0) + safeOffsetX;
            shifted[i + 1] = (Number.isFinite(part[i + 1]) ? part[i + 1] : 0) + safeOffsetY;
        }
        return shifted;
    });
}

/**
 * 좌표 배열의 산술 평균 중심을 계산합니다.
 * @param {{x: number, y: number}[]} points
 * @returns {{x: number, y: number}}
 */
function getPointCentroid(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return { x: 0, y: 0 };
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            continue;
        }

        sumX += point.x;
        sumY += point.y;
        count++;
    }

    if (count <= 0) {
        return { x: 0, y: 0 };
    }

    return {
        x: sumX / count,
        y: sumY / count
    };
}

/**
 * 현재 레이아웃 기준 셀로 사용할 anchor 로컬 좌표를 선택합니다.
 * 질량중심에 가장 가까운 셀을 anchor로 고정해 스냅 기준이 흔들리지 않게 합니다.
 * @param {{x: number, y: number}[]} points
 * @returns {{x: number, y: number}}
 */
function selectHexaLayoutAnchorPoint(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return { x: 0, y: 0 };
    }

    let bestPoint = points[0];
    let bestDistanceSq = (bestPoint.x * bestPoint.x) + (bestPoint.y * bestPoint.y);
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        if (!point) {
            continue;
        }

        const distanceSq = (point.x * point.x) + (point.y * point.y);
        if (distanceSq < (bestDistanceSq - EPSILON)) {
            bestPoint = point;
            bestDistanceSq = distanceSq;
        }
    }

    return {
        x: Number.isFinite(bestPoint?.x) ? bestPoint.x : 0,
        y: Number.isFinite(bestPoint?.y) ? bestPoint.y : 0
    };
}

/**
 * 셀 중심 기준 육각형 로컬 꼭짓점 배열을 생성합니다.
 * @param {{x: number, y: number}} center
 * @returns {{x: number, y: number}[]}
 */
function buildHexaVerticesAtCenter(center) {
    const vertices = [];
    for (let i = 0; i < HEXA_LOCAL_VERTICES.length; i++) {
        const vertex = HEXA_LOCAL_VERTICES[i];
        vertices.push({
            x: center.x + vertex.x,
            y: center.y + vertex.y
        });
    }
    return vertices;
}

/**
 * 셀 집합에서 내부 hole을 채운 셀 배열을 생성합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{q: number, r: number}[]}
 */
function fillHexaCellHoles(cells) {
    if (!Array.isArray(cells) || cells.length === 0) {
        return [];
    }

    let minQ = Number.POSITIVE_INFINITY;
    let maxQ = Number.NEGATIVE_INFINITY;
    let minR = Number.POSITIVE_INFINITY;
    let maxR = Number.NEGATIVE_INFINITY;
    const occupied = new Set();

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell) {
            continue;
        }

        occupied.add(buildHexaCellKey(cell.q, cell.r));
        if (cell.q < minQ) minQ = cell.q;
        if (cell.q > maxQ) maxQ = cell.q;
        if (cell.r < minR) minR = cell.r;
        if (cell.r > maxR) maxR = cell.r;
    }

    const searchMinQ = minQ - 1;
    const searchMaxQ = maxQ + 1;
    const searchMinR = minR - 1;
    const searchMaxR = maxR + 1;
    const visited = new Set();
    const queue = [];

    for (let q = searchMinQ; q <= searchMaxQ; q++) {
        for (let r = searchMinR; r <= searchMaxR; r++) {
            const onBoundary = q === searchMinQ || q === searchMaxQ || r === searchMinR || r === searchMaxR;
            if (!onBoundary) {
                continue;
            }

            const key = buildHexaCellKey(q, r);
            if (occupied.has(key) || visited.has(key)) {
                continue;
            }

            visited.add(key);
            queue.push({ q, r });
        }
    }

    while (queue.length > 0) {
        const current = queue.shift();
        for (let i = 0; i < HEXA_AXIAL_DIRECTIONS.length; i++) {
            const nextQ = current.q + HEXA_AXIAL_DIRECTIONS[i].q;
            const nextR = current.r + HEXA_AXIAL_DIRECTIONS[i].r;
            if (nextQ < searchMinQ || nextQ > searchMaxQ || nextR < searchMinR || nextR > searchMaxR) {
                continue;
            }

            const nextKey = buildHexaCellKey(nextQ, nextR);
            if (occupied.has(nextKey) || visited.has(nextKey)) {
                continue;
            }

            visited.add(nextKey);
            queue.push({ q: nextQ, r: nextR });
        }
    }

    const filledCells = cells.map((cell) => ({ q: cell.q, r: cell.r }));
    for (let q = minQ; q <= maxQ; q++) {
        for (let r = minR; r <= maxR; r++) {
            const key = buildHexaCellKey(q, r);
            if (occupied.has(key) || visited.has(key)) {
                continue;
            }

            filledCells.push({ q, r });
        }
    }

    return filledCells;
}

/**
 * 셀 집합에서 boundary edge를 추출합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{start: {x: number, y: number}, end: {x: number, y: number}}[]}
 */
function buildHexaBoundaryEdges(cells) {
    if (!Array.isArray(cells) || cells.length === 0) {
        return [];
    }

    const occupied = new Set();
    for (let i = 0; i < cells.length; i++) {
        occupied.add(buildHexaCellKey(cells[i].q, cells[i].r));
    }

    const edges = [];
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const center = axialToLocalPoint(cell.q, cell.r);
        const vertices = buildHexaVerticesAtCenter(center);

        for (let edgeIndex = 0; edgeIndex < HEXA_EXPOSED_EDGE_DIRECTIONS.length; edgeIndex++) {
            const direction = HEXA_EXPOSED_EDGE_DIRECTIONS[edgeIndex];
            const neighborKey = buildHexaCellKey(cell.q + direction.q, cell.r + direction.r);
            if (occupied.has(neighborKey)) {
                continue;
            }

            edges.push({
                start: vertices[edgeIndex],
                end: vertices[(edgeIndex + 1) % vertices.length]
            });
        }
    }

    return edges;
}

/**
 * boundary edge 방향 각도를 계산합니다.
 * @param {{start: {x: number, y: number}, end: {x: number, y: number}}} edge
 * @returns {number}
 */
function getBoundaryEdgeAngle(edge) {
    if (!edge?.start || !edge?.end) {
        return 0;
    }

    return Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x);
}

/**
 * 라디안 각도 차이를 0 이상 2PI 미만으로 정규화합니다.
 * @param {number} radians
 * @returns {number}
 */
function normalizePositiveRadians(radians) {
    const fullTurn = Math.PI * 2;
    let normalized = Number.isFinite(radians) ? radians % fullTurn : 0;
    if (normalized < 0) {
        normalized += fullTurn;
    }
    return normalized;
}

/**
 * 현재 edge 다음에 이어질 boundary edge를 선택합니다.
 * 같은 시작 정점을 공유하는 후보 중, 현재 진행 방향에서 가장 큰 회전으로 이어지는 edge를 고릅니다.
 * exposed edge가 시계 방향으로 정렬되어 있으므로, 외곽을 따라가려면 우회전(정규화 각도 기준 가장 큰 값)을 우선해야 합니다.
 * @param {{start: {x: number, y: number}, end: {x: number, y: number}, edgeIndex: number}} currentEdge
 * @param {{start: {x: number, y: number}, end: {x: number, y: number}, edgeIndex: number}[]} candidates
 * @param {Set<number>} used
 * @returns {{start: {x: number, y: number}, end: {x: number, y: number}, edgeIndex: number}|null}
 */
function selectNextBoundaryEdge(currentEdge, candidates, used) {
    if (!currentEdge || !Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    const currentAngle = getBoundaryEdgeAngle(currentEdge);
    let bestCandidate = null;
    let bestTurn = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (!candidate || used.has(candidate.edgeIndex)) {
            continue;
        }

        const candidateAngle = getBoundaryEdgeAngle(candidate);
        const turn = normalizePositiveRadians(candidateAngle - currentAngle);
        if (turn > bestTurn + EPSILON) {
            bestTurn = turn;
            bestCandidate = candidate;
        }
    }

    return bestCandidate;
}

/**
 * boundary edge 집합을 루프 배열로 변환합니다.
 * @param {{start: {x: number, y: number}, end: {x: number, y: number}}[]} edges
 * @returns {{x: number, y: number}[][]}
 */
function buildBoundaryLoops(edges) {
    if (!Array.isArray(edges) || edges.length === 0) {
        return [];
    }

    const outgoing = new Map();
    const used = new Set();
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const key = buildVertexKey(edge.start.x, edge.start.y);
        if (!outgoing.has(key)) {
            outgoing.set(key, []);
        }
        outgoing.get(key).push({ ...edge, edgeIndex: i });
    }

    const loops = [];
    for (let i = 0; i < edges.length; i++) {
        if (used.has(i)) {
            continue;
        }

        const loop = [];
        let current = { ...edges[i], edgeIndex: i };
        let safety = 0;
        const startKey = buildVertexKey(current.start.x, current.start.y);

        while (current && !used.has(current.edgeIndex) && safety < (edges.length + 4)) {
            used.add(current.edgeIndex);
            loop.push({ x: current.start.x, y: current.start.y });

            const nextKey = buildVertexKey(current.end.x, current.end.y);
            if (nextKey === startKey) {
                if (loop.length >= 3) {
                    loops.push(loop);
                }
                break;
            }

            const nextEdges = outgoing.get(nextKey) || [];
            const next = selectNextBoundaryEdge(current, nextEdges, used);
            safety++;
            if (!next) {
                break;
            }

            current = next;
        }
    }

    return loops;
}

/**
 * 다각형 signed area를 계산합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {number}
 */
function getPolygonSignedArea(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
        return 0;
    }

    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const current = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        area += (current.x * next.y) - (next.x * current.y);
    }
    return area * 0.5;
}

/**
 * collinear vertex를 제거해 경계를 단순화합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {{x: number, y: number}[]}
 */
function mergeCollinearBoundaryVertices(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
        return Array.isArray(vertices) ? [...vertices] : [];
    }

    const simplified = [];
    for (let i = 0; i < vertices.length; i++) {
        const prev = vertices[(i - 1 + vertices.length) % vertices.length];
        const current = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        const abX = current.x - prev.x;
        const abY = current.y - prev.y;
        const bcX = next.x - current.x;
        const bcY = next.y - current.y;
        const cross = (abX * bcY) - (abY * bcX);
        if (Math.abs(cross) <= EPSILON) {
            continue;
        }
        simplified.push({ x: current.x, y: current.y });
    }
    return simplified.length >= 3 ? simplified : [...vertices];
}

/**
 * 두 정점이 사실상 같은 좌표인지 판정합니다.
 * @param {{x: number, y: number}} left
 * @param {{x: number, y: number}} right
 * @returns {boolean}
 */
function isSameBoundaryVertex(left, right) {
    return Math.abs((left?.x ?? 0) - (right?.x ?? 0)) <= EPSILON
        && Math.abs((left?.y ?? 0) - (right?.y ?? 0)) <= EPSILON;
}

/**
 * 꼭짓점 배열을 평면 숫자 배열로 평탄화합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {number[]}
 */
function flattenBoundaryVertices(vertices) {
    const flat = [];
    if (!Array.isArray(vertices)) {
        return flat;
    }

    for (let i = 0; i < vertices.length; i++) {
        const vertex = vertices[i];
        flat.push(
            Number.isFinite(vertex?.x) ? vertex.x : 0,
            Number.isFinite(vertex?.y) ? vertex.y : 0
        );
    }
    return flat;
}

/**
 * 숫자 배열 다각형을 꼭짓점 배열로 변환합니다.
 * @param {number[]} polygon
 * @returns {{x: number, y: number}[]}
 */
function unflattenBoundaryVertices(polygon) {
    const vertices = [];
    if (!Array.isArray(polygon)) {
        return vertices;
    }

    for (let i = 0; i < polygon.length; i += 2) {
        vertices.push({
            x: Number.isFinite(polygon[i]) ? polygon[i] : 0,
            y: Number.isFinite(polygon[i + 1]) ? polygon[i + 1] : 0
        });
    }
    return vertices;
}

/**
 * 평탄화된 숫자 배열 다각형의 절대 면적을 계산합니다.
 * @param {number[]} polygon
 * @returns {number}
 */
function getFlattenedPolygonArea(polygon) {
    if (!Array.isArray(polygon) || polygon.length < 6) {
        return 0;
    }

    let area = 0;
    for (let i = 0; i < polygon.length; i += 2) {
        const nextIndex = (i + 2) % polygon.length;
        const currentX = Number.isFinite(polygon[i]) ? polygon[i] : 0;
        const currentY = Number.isFinite(polygon[i + 1]) ? polygon[i + 1] : 0;
        const nextX = Number.isFinite(polygon[nextIndex]) ? polygon[nextIndex] : 0;
        const nextY = Number.isFinite(polygon[nextIndex + 1]) ? polygon[nextIndex + 1] : 0;
        area += (currentX * nextY) - (nextX * currentY);
    }

    return Math.abs(area * 0.5);
}

/**
 * 다각형이 볼록인지 판정합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {boolean}
 */
function isConvexBoundaryPolygon(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
        return false;
    }

    let orientation = 0;
    for (let i = 0; i < vertices.length; i++) {
        const prev = vertices[(i - 1 + vertices.length) % vertices.length];
        const current = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        const cross = ((current.x - prev.x) * (next.y - current.y))
            - ((current.y - prev.y) * (next.x - current.x));
        if (Math.abs(cross) <= EPSILON) {
            continue;
        }

        const sign = Math.sign(cross);
        if (orientation === 0) {
            orientation = sign;
            continue;
        }
        if (orientation !== sign) {
            return false;
        }
    }

    return true;
}

/**
 * 두 다각형이 공통 변을 가지는지 확인합니다.
 * @param {{x: number, y: number}[]} verticesA
 * @param {{x: number, y: number}[]} verticesB
 * @returns {boolean}
 */
function hasSharedCollisionEdge(verticesA, verticesB) {
    if (!Array.isArray(verticesA) || !Array.isArray(verticesB) || verticesA.length < 2 || verticesB.length < 2) {
        return false;
    }

    for (let indexA = 0; indexA < verticesA.length; indexA++) {
        const nextIndexA = (indexA + 1) % verticesA.length;
        for (let indexB = 0; indexB < verticesB.length; indexB++) {
            const nextIndexB = (indexB + 1) % verticesB.length;
            const sameDirection = (
                isSameBoundaryVertex(verticesA[indexA], verticesB[indexB])
                && isSameBoundaryVertex(verticesA[nextIndexA], verticesB[nextIndexB])
            );
            const reversedDirection = (
                isSameBoundaryVertex(verticesA[indexA], verticesB[nextIndexB])
                && isSameBoundaryVertex(verticesA[nextIndexA], verticesB[indexB])
            );
            if (sameDirection || reversedDirection) {
                return true;
            }
        }
    }

    return false;
}

/**
 * 두 다각형의 고유 정점 배열을 생성합니다.
 * @param {{x: number, y: number}[]} verticesA
 * @param {{x: number, y: number}[]} verticesB
 * @returns {{x: number, y: number}[]}
 */
function buildMergedCollisionVertices(verticesA, verticesB) {
    const uniqueVertices = new Map();
    const collect = (vertices) => {
        for (let i = 0; i < vertices.length; i++) {
            const vertex = vertices[i];
            uniqueVertices.set(buildVertexKey(vertex.x, vertex.y), {
                x: vertex.x,
                y: vertex.y
            });
        }
    };

    collect(verticesA);
    collect(verticesB);
    return [...uniqueVertices.values()];
}

/**
 * 2차원 점들의 볼록 껍질을 계산합니다.
 * @param {{x: number, y: number}[]} points
 * @returns {{x: number, y: number}[]}
 */
function buildConvexHull(points) {
    if (!Array.isArray(points) || points.length < 3) {
        return Array.isArray(points) ? [...points] : [];
    }

    const sortedPoints = [...points].sort((left, right) => {
        if (Math.abs(left.x - right.x) > EPSILON) {
            return left.x - right.x;
        }
        return left.y - right.y;
    });
    const cross = (origin, pointA, pointB) => (
        ((pointA.x - origin.x) * (pointB.y - origin.y))
        - ((pointA.y - origin.y) * (pointB.x - origin.x))
    );

    const lower = [];
    for (let i = 0; i < sortedPoints.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sortedPoints[i]) <= EPSILON) {
            lower.pop();
        }
        lower.push(sortedPoints[i]);
    }

    const upper = [];
    for (let i = sortedPoints.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sortedPoints[i]) <= EPSILON) {
            upper.pop();
        }
        upper.push(sortedPoints[i]);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

/**
 * 경계 선분 길이를 계산합니다.
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} end
 * @returns {number}
 */
function getBoundarySegmentLength(start, end) {
    const dx = (Number.isFinite(end?.x) ? end.x : 0) - (Number.isFinite(start?.x) ? start.x : 0);
    const dy = (Number.isFinite(end?.y) ? end.y : 0) - (Number.isFinite(start?.y) ? start.y : 0);
    return Math.hypot(dx, dy);
}

/**
 * 삼각형의 절대 면적을 계산합니다.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number}} c
 * @returns {number}
 */
function getBoundaryTriangleArea(a, b, c) {
    return Math.abs(
        (((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x))) * 0.5
    );
}

/**
 * 바깥 경계 기준 reflex turn인지 판정합니다.
 * @param {{x: number, y: number}} prev
 * @param {{x: number, y: number}} current
 * @param {{x: number, y: number}} next
 * @param {boolean} isPositiveWinding
 * @returns {boolean}
 */
function isConcaveBoundaryVertex(prev, current, next, isPositiveWinding) {
    const cross = ((current.x - prev.x) * (next.y - current.y))
        - ((current.y - prev.y) * (next.x - current.x));
    if (Math.abs(cross) <= EPSILON) {
        return false;
    }

    return isPositiveWinding ? cross < -EPSILON : cross > EPSILON;
}

/**
 * 작은 이등변 삼각 notch인지 판정합니다.
 * @param {{x: number, y: number}} prev
 * @param {{x: number, y: number}} current
 * @param {{x: number, y: number}} next
 * @param {boolean} isPositiveWinding
 * @returns {boolean}
 */
function isShallowBoundaryNotch(prev, current, next, isPositiveWinding) {
    if (!isConcaveBoundaryVertex(prev, current, next, isPositiveWinding)) {
        return false;
    }

    const prevLength = getBoundarySegmentLength(prev, current);
    const nextLength = getBoundarySegmentLength(current, next);
    if (Math.abs(prevLength - HEXA_BOUNDARY_NOTCH_EDGE_LENGTH) > HEXA_BOUNDARY_NOTCH_EDGE_TOLERANCE) {
        return false;
    }
    if (Math.abs(nextLength - HEXA_BOUNDARY_NOTCH_EDGE_LENGTH) > HEXA_BOUNDARY_NOTCH_EDGE_TOLERANCE) {
        return false;
    }
    if (Math.abs(prevLength - nextLength) > HEXA_BOUNDARY_NOTCH_EDGE_TOLERANCE) {
        return false;
    }

    const triangleArea = getBoundaryTriangleArea(prev, current, next);
    return Math.abs(triangleArea - HEXA_BOUNDARY_NOTCH_AREA) <= HEXA_BOUNDARY_NOTCH_AREA_TOLERANCE;
}

/**
 * 바깥 경계의 작은 삼각 notch만 제거합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {{x: number, y: number}[]}
 */
function simplifyShallowBoundaryNotches(vertices) {
    let simplified = mergeCollinearBoundaryVertices(vertices);
    if (!Array.isArray(simplified) || simplified.length < 3) {
        return Array.isArray(simplified) ? [...simplified] : [];
    }

    let changed = true;
    let passCount = 0;
    const maxPassCount = Math.max(
        HEXA_BOUNDARY_NOTCH_SIMPLIFY_MAX_PASSES,
        simplified.length * 4
    );
    while (changed && simplified.length >= 3 && passCount < maxPassCount) {
        changed = false;
        const isPositiveWinding = getPolygonSignedArea(simplified) >= 0;
        for (let i = 0; i < simplified.length; i++) {
            const prev = simplified[(i - 1 + simplified.length) % simplified.length];
            const current = simplified[i];
            const next = simplified[(i + 1) % simplified.length];
            if (!isShallowBoundaryNotch(prev, current, next, isPositiveWinding)) {
                continue;
            }

            simplified.splice(i, 1);
            simplified = mergeCollinearBoundaryVertices(simplified);
            changed = true;
            break;
        }
        passCount++;
    }

    return simplified;
}

/**
 * 경계 턴의 외적 값을 계산합니다.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number}} c
 * @returns {number}
 */
function getBoundaryTurnCross(a, b, c) {
    return ((b.x - a.x) * (c.y - a.y))
        - ((b.y - a.y) * (c.x - a.x));
}

/**
 * 점이 유향 선분의 왼쪽에 있는지 판정합니다.
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} end
 * @param {{x: number, y: number}} point
 * @returns {boolean}
 */
function isBoundaryLeft(start, end, point) {
    return getBoundaryTurnCross(start, end, point) > EPSILON;
}

/**
 * 점이 유향 선분의 왼쪽 또는 위에 있는지 판정합니다.
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} end
 * @param {{x: number, y: number}} point
 * @returns {boolean}
 */
function isBoundaryLeftOn(start, end, point) {
    return getBoundaryTurnCross(start, end, point) >= -EPSILON;
}

/**
 * 경계점이 선분 위에 있는지 판정합니다.
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number}} start
 * @param {{x: number, y: number}} end
 * @returns {boolean}
 */
function isBoundaryPointOnSegment(point, start, end) {
    if (Math.abs(getBoundaryTurnCross(start, end, point)) > EPSILON) {
        return false;
    }

    const minX = Math.min(start.x, end.x) - EPSILON;
    const maxX = Math.max(start.x, end.x) + EPSILON;
    const minY = Math.min(start.y, end.y) - EPSILON;
    const maxY = Math.max(start.y, end.y) + EPSILON;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

/**
 * 두 선분이 내부에서 proper intersection을 가지는지 판정합니다.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number}} c
 * @param {{x: number, y: number}} d
 * @returns {boolean}
 */
function doBoundarySegmentsProperlyIntersect(a, b, c, d) {
    const abC = getBoundaryTurnCross(a, b, c);
    const abD = getBoundaryTurnCross(a, b, d);
    const cdA = getBoundaryTurnCross(c, d, a);
    const cdB = getBoundaryTurnCross(c, d, b);
    return (abC * abD) < -EPSILON && (cdA * cdB) < -EPSILON;
}

/**
 * 두 선분이 끝점 접촉 또는 겹침을 포함해 교차하는지 판정합니다.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number}} c
 * @param {{x: number, y: number}} d
 * @returns {boolean}
 */
function doBoundarySegmentsIntersect(a, b, c, d) {
    if (doBoundarySegmentsProperlyIntersect(a, b, c, d)) {
        return true;
    }

    return isBoundaryPointOnSegment(a, c, d)
        || isBoundaryPointOnSegment(b, c, d)
        || isBoundaryPointOnSegment(c, a, b)
        || isBoundaryPointOnSegment(d, a, b);
}

/**
 * 다각형 인덱스 두 개가 인접한 꼭짓점인지 판정합니다.
 * @param {number} vertexCount
 * @param {number} leftIndex
 * @param {number} rightIndex
 * @returns {boolean}
 */
function areBoundaryVertexIndicesAdjacent(vertexCount, leftIndex, rightIndex) {
    if (!Number.isInteger(vertexCount) || vertexCount < 2) {
        return false;
    }

    const indexGap = Math.abs(leftIndex - rightIndex);
    return indexGap === 1 || indexGap === (vertexCount - 1);
}

/**
 * 분해용으로 boundary winding을 CCW로 정규화합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {{x: number, y: number}[]}
 */
function normalizeBoundaryVerticesForDecomposition(vertices) {
    const normalized = mergeCollinearBoundaryVertices(vertices);
    if (!Array.isArray(normalized) || normalized.length < 3) {
        return Array.isArray(normalized) ? [...normalized] : [];
    }

    const copied = normalized.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    return getPolygonSignedArea(copied) >= 0 ? copied : copied.reverse();
}

/**
 * CCW boundary 기준 reflex 꼭짓점 인덱스를 수집합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {number[]}
 */
function collectConcaveBoundaryVertexIndices(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
        return [];
    }

    const indices = [];
    for (let i = 0; i < vertices.length; i++) {
        const prev = vertices[(i - 1 + vertices.length) % vertices.length];
        const current = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        if (getBoundaryTurnCross(prev, current, next) < -EPSILON) {
            indices.push(i);
        }
    }
    return indices;
}

/**
 * 대각선이 기준 꼭짓점의 내부 cone 안에 있는지 판정합니다.
 * CCW winding을 전제로 합니다.
 * @param {{x: number, y: number}[]} vertices
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {boolean}
 */
function isBoundaryDiagonalInCone(vertices, fromIndex, toIndex) {
    const prev = vertices[(fromIndex - 1 + vertices.length) % vertices.length];
    const current = vertices[fromIndex];
    const next = vertices[(fromIndex + 1) % vertices.length];
    const target = vertices[toIndex];
    const isConvex = getBoundaryTurnCross(prev, current, next) >= -EPSILON;
    if (isConvex) {
        return isBoundaryLeft(current, target, prev)
            && isBoundaryLeft(target, current, next);
    }

    return !(
        isBoundaryLeftOn(current, target, next)
        && isBoundaryLeftOn(target, current, prev)
    );
}

/**
 * 대각선이 기존 경계선과 교차하는지 검사합니다.
 * @param {{x: number, y: number}[]} vertices
 * @param {number} leftIndex
 * @param {number} rightIndex
 * @returns {boolean}
 */
function doesBoundaryDiagonalIntersectEdges(vertices, leftIndex, rightIndex) {
    const start = vertices[leftIndex];
    const end = vertices[rightIndex];
    for (let i = 0; i < vertices.length; i++) {
        const nextIndex = (i + 1) % vertices.length;
        if (
            i === leftIndex
            || nextIndex === leftIndex
            || i === rightIndex
            || nextIndex === rightIndex
        ) {
            continue;
        }

        if (doBoundarySegmentsIntersect(start, end, vertices[i], vertices[nextIndex])) {
            return true;
        }
    }

    return false;
}

/**
 * 두 boundary 꼭짓점을 잇는 대각선이 유효한지 판정합니다.
 * @param {{x: number, y: number}[]} vertices
 * @param {number} leftIndex
 * @param {number} rightIndex
 * @returns {boolean}
 */
function isBoundaryDiagonalValid(vertices, leftIndex, rightIndex) {
    if (!Array.isArray(vertices) || vertices.length < 4) {
        return false;
    }
    if (leftIndex === rightIndex || areBoundaryVertexIndicesAdjacent(vertices.length, leftIndex, rightIndex)) {
        return false;
    }

    return isBoundaryDiagonalInCone(vertices, leftIndex, rightIndex)
        && isBoundaryDiagonalInCone(vertices, rightIndex, leftIndex)
        && !doesBoundaryDiagonalIntersectEdges(vertices, leftIndex, rightIndex);
}

/**
 * 순환 boundary에서 시작/끝 인덱스 inclusive 구간을 복사합니다.
 * @param {{x: number, y: number}[]} vertices
 * @param {number} startIndex
 * @param {number} endIndex
 * @returns {{x: number, y: number}[]}
 */
function buildBoundaryVertexSlice(vertices, startIndex, endIndex) {
    const sliced = [];
    let index = startIndex;
    let safety = 0;
    while (safety <= vertices.length) {
        const vertex = vertices[index];
        sliced.push({ x: vertex.x, y: vertex.y });
        if (index === endIndex) {
            break;
        }

        index = (index + 1) % vertices.length;
        safety++;
    }

    return mergeCollinearBoundaryVertices(sliced);
}

/**
 * 대각선을 따라 boundary polygon을 두 조각으로 분할합니다.
 * @param {{x: number, y: number}[]} vertices
 * @param {number} leftIndex
 * @param {number} rightIndex
 * @returns {{leftVertices: {x: number, y: number}[], rightVertices: {x: number, y: number}[]}|null}
 */
function splitBoundaryVerticesAlongDiagonal(vertices, leftIndex, rightIndex) {
    const leftVertices = buildBoundaryVertexSlice(vertices, leftIndex, rightIndex);
    const rightVertices = buildBoundaryVertexSlice(vertices, rightIndex, leftIndex);
    if (leftVertices.length < 3 || rightVertices.length < 3) {
        return null;
    }

    const leftArea = Math.abs(getPolygonSignedArea(leftVertices));
    const rightArea = Math.abs(getPolygonSignedArea(rightVertices));
    if (leftArea <= EPSILON || rightArea <= EPSILON) {
        return null;
    }

    return {
        leftVertices,
        rightVertices
    };
}

/**
 * reflex vertex 기반 최적 분할 대각선을 선택합니다.
 * reflex 감소량을 우선하고, 동률이면 더 짧은 대각선을 우선합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {{leftVertices: {x: number, y: number}[], rightVertices: {x: number, y: number}[]}|null}
 */
function selectBestBoundarySplit(vertices) {
    const concaveIndices = collectConcaveBoundaryVertexIndices(vertices);
    if (concaveIndices.length === 0) {
        return null;
    }

    let bestSplit = null;
    for (let concaveIndexPosition = 0; concaveIndexPosition < concaveIndices.length; concaveIndexPosition++) {
        const concaveIndex = concaveIndices[concaveIndexPosition];
        for (let candidateIndex = 0; candidateIndex < vertices.length; candidateIndex++) {
            if (!isBoundaryDiagonalValid(vertices, concaveIndex, candidateIndex)) {
                continue;
            }

            const split = splitBoundaryVerticesAlongDiagonal(vertices, concaveIndex, candidateIndex);
            if (!split) {
                continue;
            }

            const leftConcaveCount = collectConcaveBoundaryVertexIndices(split.leftVertices).length;
            const rightConcaveCount = collectConcaveBoundaryVertexIndices(split.rightVertices).length;
            const reflexReduction = concaveIndices.length - (leftConcaveCount + rightConcaveCount);
            const convexPartCount = (isConvexBoundaryPolygon(split.leftVertices) ? 1 : 0)
                + (isConvexBoundaryPolygon(split.rightVertices) ? 1 : 0);
            const diagonalLength = getBoundarySegmentLength(
                vertices[concaveIndex],
                vertices[candidateIndex]
            );
            const areaBalance = Math.abs(
                Math.abs(getPolygonSignedArea(split.leftVertices))
                - Math.abs(getPolygonSignedArea(split.rightVertices))
            );

            if (
                !bestSplit
                || reflexReduction > bestSplit.reflexReduction
                || (
                    reflexReduction === bestSplit.reflexReduction
                    && convexPartCount > bestSplit.convexPartCount
                )
                || (
                    reflexReduction === bestSplit.reflexReduction
                    && convexPartCount === bestSplit.convexPartCount
                    && diagonalLength < (bestSplit.diagonalLength - EPSILON)
                )
                || (
                    reflexReduction === bestSplit.reflexReduction
                    && convexPartCount === bestSplit.convexPartCount
                    && Math.abs(diagonalLength - bestSplit.diagonalLength) <= EPSILON
                    && areaBalance < (bestSplit.areaBalance - EPSILON)
                )
            ) {
                bestSplit = {
                    leftVertices: split.leftVertices,
                    rightVertices: split.rightVertices,
                    reflexReduction,
                    convexPartCount,
                    diagonalLength,
                    areaBalance
                };
            }
        }
    }

    return bestSplit
        ? {
            leftVertices: bestSplit.leftVertices,
            rightVertices: bestSplit.rightVertices
        }
        : null;
}

/**
 * boundary polygon을 reflex vertex 기준으로 재귀 분할해 convex part 집합으로 변환합니다.
 * @param {{x: number, y: number}[]} vertices
 * @param {number} [depth=0]
 * @returns {number[][]}
 */
function decomposeBoundaryVerticesToConvexParts(vertices, depth = 0) {
    const normalizedVertices = normalizeBoundaryVerticesForDecomposition(vertices);
    if (normalizedVertices.length < 3) {
        return [];
    }
    if (isConvexBoundaryPolygon(normalizedVertices)) {
        return [flattenBoundaryVertices(normalizedVertices)];
    }
    if (depth > normalizedVertices.length * 2) {
        return [];
    }

    const bestSplit = selectBestBoundarySplit(normalizedVertices);
    if (!bestSplit) {
        return [];
    }

    const leftParts = decomposeBoundaryVerticesToConvexParts(bestSplit.leftVertices, depth + 1);
    const rightParts = decomposeBoundaryVerticesToConvexParts(bestSplit.rightVertices, depth + 1);
    if (leftParts.length === 0 || rightParts.length === 0) {
        return [];
    }

    return mergeConvexCollisionParts(leftParts.concat(rightParts));
}

/**
 * 두 볼록 다각형이 하나의 더 큰 볼록 다각형으로 정확히 병합 가능한지 검사합니다.
 * @param {number[]} polygonA
 * @param {number[]} polygonB
 * @returns {number[]|null}
 */
function tryMergeConvexCollisionParts(polygonA, polygonB) {
    const verticesA = unflattenBoundaryVertices(polygonA);
    const verticesB = unflattenBoundaryVertices(polygonB);
    if (verticesA.length < 3 || verticesB.length < 3) {
        return null;
    }

    if (!hasSharedCollisionEdge(verticesA, verticesB)) {
        return null;
    }

    const mergedVertices = buildMergedCollisionVertices(verticesA, verticesB);
    const hull = mergeCollinearBoundaryVertices(buildConvexHull(mergedVertices));
    if (hull.length < 3 || !isConvexBoundaryPolygon(hull)) {
        return null;
    }

    const areaA = Math.abs(getPolygonSignedArea(verticesA));
    const areaB = Math.abs(getPolygonSignedArea(verticesB));
    const sourceArea = areaA + areaB;
    const hullArea = Math.abs(getPolygonSignedArea(hull));
    if (Math.abs(hullArea - sourceArea) > COLLISION_PART_MERGE_AREA_EPSILON) {
        return null;
    }

    return flattenBoundaryVertices(hull);
}

/**
 * 삼각분할 결과를 가능한 범위에서 더 큰 볼록 part로 병합합니다.
 * @param {number[][]} polygons
 * @returns {number[][]}
 */
function mergeConvexCollisionParts(polygons) {
    const mergedPolygons = Array.isArray(polygons)
        ? polygons
            .filter((polygon) => Array.isArray(polygon) && polygon.length >= 6)
            .map((polygon) => [...polygon])
        : [];
    if (mergedPolygons.length <= 1) {
        return mergedPolygons;
    }

    let changed = true;
    while (changed) {
        changed = false;
        let bestPair = null;
        for (let i = 0; i < mergedPolygons.length; i++) {
            for (let j = i + 1; j < mergedPolygons.length; j++) {
                const combined = tryMergeConvexCollisionParts(
                    mergedPolygons[i],
                    mergedPolygons[j]
                );
                if (!combined) {
                    continue;
                }

                const areaA = getFlattenedPolygonArea(mergedPolygons[i]);
                const areaB = getFlattenedPolygonArea(mergedPolygons[j]);
                const combinedArea = getFlattenedPolygonArea(combined);
                const extraArea = Math.max(0, combinedArea - (areaA + areaB));
                if (!bestPair || extraArea < bestPair.extraArea - COLLISION_PART_MERGE_AREA_EPSILON) {
                    bestPair = {
                        leftIndex: i,
                        rightIndex: j,
                        polygon: combined,
                        extraArea
                    };
                }
            }
        }

        if (bestPair) {
            mergedPolygons[bestPair.leftIndex] = bestPair.polygon;
            mergedPolygons.splice(bestPair.rightIndex, 1);
            changed = true;
        }
    }

    return mergedPolygons;
}

/**
 * 삼각형 내부 점 포함 여부를 판정합니다.
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number}} c
 * @returns {boolean}
 */
function isPointInsideTriangle(point, a, b, c) {
    const v0X = c.x - a.x;
    const v0Y = c.y - a.y;
    const v1X = b.x - a.x;
    const v1Y = b.y - a.y;
    const v2X = point.x - a.x;
    const v2Y = point.y - a.y;

    const dot00 = (v0X * v0X) + (v0Y * v0Y);
    const dot01 = (v0X * v1X) + (v0Y * v1Y);
    const dot02 = (v0X * v2X) + (v0Y * v2Y);
    const dot11 = (v1X * v1X) + (v1Y * v1Y);
    const dot12 = (v1X * v2X) + (v1Y * v2Y);
    const denominator = (dot00 * dot11) - (dot01 * dot01);
    if (Math.abs(denominator) <= EPSILON) {
        return false;
    }

    const inverse = 1 / denominator;
    const u = ((dot11 * dot02) - (dot01 * dot12)) * inverse;
    const v = ((dot00 * dot12) - (dot01 * dot02)) * inverse;
    return u >= -EPSILON && v >= -EPSILON && (u + v) <= (1 + EPSILON);
}

/**
 * 단순 다각형을 ear clipping으로 삼각분할합니다.
 * @param {{x: number, y: number}[]} vertices
 * @returns {number[][]}
 */
function triangulateSimplePolygon(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
        return [];
    }

    const working = vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    const triangles = [];
    const isPositiveArea = getPolygonSignedArea(working) > 0;
    let safety = 0;

    while (working.length > 3 && safety < 4096) {
        let earFound = false;
        for (let i = 0; i < working.length; i++) {
            const prev = working[(i - 1 + working.length) % working.length];
            const current = working[i];
            const next = working[(i + 1) % working.length];
            const cross = ((current.x - prev.x) * (next.y - current.y))
                - ((current.y - prev.y) * (next.x - current.x));
            const isConvex = isPositiveArea ? cross > EPSILON : cross < -EPSILON;
            if (!isConvex) {
                continue;
            }

            let containsPoint = false;
            for (let j = 0; j < working.length; j++) {
                if (j === i || j === (i - 1 + working.length) % working.length || j === (i + 1) % working.length) {
                    continue;
                }

                if (isPointInsideTriangle(working[j], prev, current, next)) {
                    containsPoint = true;
                    break;
                }
            }
            if (containsPoint) {
                continue;
            }

            triangles.push([
                prev.x, prev.y,
                current.x, current.y,
                next.x, next.y
            ]);
            working.splice(i, 1);
            earFound = true;
            break;
        }

        if (!earFound) {
            return [];
        }
        safety++;
    }

    if (working.length === 3) {
        triangles.push([
            working[0].x, working[0].y,
            working[1].x, working[1].y,
            working[2].x, working[2].y
        ]);
    }

    return triangles;
}

/**
 * 셀 집합에서 가장 바깥 outer boundary만 추출합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{x: number, y: number}[]}
 */
function buildHexaOuterBoundaryVertices(cells) {
    const boundaryEdges = buildHexaBoundaryEdges(cells);
    const loops = buildBoundaryLoops(boundaryEdges);
    if (loops.length === 0) {
        return [];
    }

    let bestLoop = loops[0];
    let bestArea = Math.abs(getPolygonSignedArea(bestLoop));
    for (let i = 1; i < loops.length; i++) {
        const area = Math.abs(getPolygonSignedArea(loops[i]));
        if (area > bestArea) {
            bestArea = area;
            bestLoop = loops[i];
        }
    }

    return mergeCollinearBoundaryVertices(bestLoop);
}

/**
 * 경계 꼭짓점 배열을 convex collision part들로 분해합니다.
 * @param {{x: number, y: number}[]} boundaryVertices
 * @returns {number[][]}
 */
function buildCollisionPartsFromBoundaryVertices(boundaryVertices) {
    if (!Array.isArray(boundaryVertices) || boundaryVertices.length < 3) {
        return [];
    }

    const decomposedParts = decomposeBoundaryVerticesToConvexParts(boundaryVertices);
    if (decomposedParts.length > 0) {
        return decomposedParts;
    }

    const triangles = triangulateSimplePolygon(boundaryVertices);
    if (triangles.length > 0) {
        const mergedParts = mergeConvexCollisionParts(triangles);
        if (mergedParts.length > 0) {
            return mergedParts;
        }
    }

    return isConvexBoundaryPolygon(boundaryVertices)
        ? [flattenBoundaryVertices(boundaryVertices)]
        : [];
}

/**
 * 채워진 셀 집합을 육각형 part 목록으로 변환합니다.
 * boundary 분해 실패 시 fallback으로 사용합니다.
 * @param {{q: number, r: number}[]} filledCells
 * @returns {number[][]}
 */
function buildFallbackHexaCollisionParts(filledCells) {
    const parts = [];
    for (let i = 0; i < filledCells.length; i++) {
        const center = axialToLocalPoint(filledCells[i].q, filledCells[i].r);
        const vertices = buildHexaVerticesAtCenter(center);
        const part = [];
        for (let j = 0; j < vertices.length; j++) {
            part.push(vertices[j].x, vertices[j].y);
        }
        parts.push(part);
    }
    return parts;
}

/**
 * outer boundary와 충돌용 boundary part를 함께 생성합니다.
 * @param {{q: number, r: number}[]} cells
 * @returns {{outlineVertices: {x: number, y: number}[], collisionLocalParts: number[][]}}
 */
function buildBoundaryCollisionParts(cells) {
    const outlineVertices = buildHexaOuterBoundaryVertices(cells);
    if (outlineVertices.length < 3) {
        return {
            outlineVertices: [],
            collisionLocalParts: []
        };
    }

    const collisionBoundaryVertices = simplifyShallowBoundaryNotches(outlineVertices);
    const collisionLocalParts = buildCollisionPartsFromBoundaryVertices(collisionBoundaryVertices);
    return {
        outlineVertices,
        collisionLocalParts
    };
}

/**
 * 월드 셀 중심 목록을 hex-hive 레이아웃으로 변환합니다.
 * @param {{x: number, y: number}[]} worldCells
 * @param {{originX: number, originY: number, baseHeight: number, rotationDeg?: number}} options
 * @returns {{schemaVersion: number, visibleCells: {q: number, r: number}[], filledCells: {q: number, r: number}[], visibleLocalCenters: {x: number, y: number}[], filledLocalCenters: {x: number, y: number}[], outlineVertices: {x: number, y: number}[], collisionLocalParts: number[][]}}
 */
export function createHexaHiveLayoutFromWorldCells(worldCells, options) {
    const originX = Number.isFinite(options?.originX) ? options.originX : 0;
    const originY = Number.isFinite(options?.originY) ? options.originY : 0;
    const baseHeight = Number.isFinite(options?.baseHeight) && options.baseHeight > EPSILON
        ? options.baseHeight
        : 1;
    const inverseRotation = -toRadians(options?.rotationDeg ?? 0);
    const visibleCellMap = new Map();
    const normalizedLocalPoints = [];

    if (Array.isArray(worldCells)) {
        for (let i = 0; i < worldCells.length; i++) {
            const cell = worldCells[i];
            if (!cell || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) {
                continue;
            }

            const localX = (cell.x - originX) / baseHeight;
            const localY = (cell.y - originY) / baseHeight;
            const unrotated = rotatePoint(localX, localY, inverseRotation);
            normalizedLocalPoints.push(unrotated);
        }
    }

    const anchorPoint = selectHexaLayoutAnchorPoint(normalizedLocalPoints);
    for (let i = 0; i < normalizedLocalPoints.length; i++) {
        const point = normalizedLocalPoints[i];
        const axial = localPointToAxial(
            point.x - anchorPoint.x,
            point.y - anchorPoint.y
        );
        const rounded = roundAxialCell(axial.q, axial.r);
        visibleCellMap.set(buildHexaCellKey(rounded.q, rounded.r), rounded);
    }

    const visibleCells = connectDetachedHexaCellComponents([...visibleCellMap.values()]);
    const filledCells = fillHexaCellHoles(visibleCells);
    const boundaryData = buildBoundaryCollisionParts(visibleCells);
    const baseCollisionLocalParts = boundaryData.collisionLocalParts.length > 0
        ? boundaryData.collisionLocalParts
        : buildFallbackHexaCollisionParts(filledCells);
    const snappedVisibleLocalCenters = offsetLocalPoints(
        buildLocalCentersFromCells(visibleCells),
        anchorPoint.x,
        anchorPoint.y
    );
    const targetCentroid = getPointCentroid(normalizedLocalPoints);
    const snappedCentroid = getPointCentroid(snappedVisibleLocalCenters);
    const recenterOffsetX = targetCentroid.x - snappedCentroid.x;
    const recenterOffsetY = targetCentroid.y - snappedCentroid.y;
    const visibleLocalCenters = offsetLocalPoints(
        snappedVisibleLocalCenters,
        recenterOffsetX,
        recenterOffsetY
    );
    const filledLocalCenters = offsetLocalPoints(
        offsetLocalPoints(buildLocalCentersFromCells(filledCells), anchorPoint.x, anchorPoint.y),
        recenterOffsetX,
        recenterOffsetY
    );
    const outlineVertices = offsetLocalPoints(
        offsetLocalPoints(boundaryData.outlineVertices, anchorPoint.x, anchorPoint.y),
        recenterOffsetX,
        recenterOffsetY
    );
    const collisionLocalParts = offsetCollisionParts(
        offsetCollisionParts(baseCollisionLocalParts, anchorPoint.x, anchorPoint.y),
        recenterOffsetX,
        recenterOffsetY
    );

    return {
        schemaVersion: HEXA_HIVE_LAYOUT_SCHEMA_VERSION,
        visibleCells: visibleCells.map((cell) => ({ q: cell.q, r: cell.r })),
        filledCells: filledCells.map((cell) => ({ q: cell.q, r: cell.r })),
        visibleLocalCenters,
        filledLocalCenters,
        outlineVertices,
        collisionLocalParts: collisionLocalParts.map((part) => [...part])
    };
}

/**
 * 합체 적 레이아웃을 깊은 복제로 정규화합니다.
 * @param {object|null|undefined} layout
 * @returns {object|null}
 */
export function cloneHexaHiveLayout(layout) {
    if (!layout || typeof layout !== 'object') {
        return null;
    }

    return {
        schemaVersion: Number.isInteger(layout.schemaVersion)
            ? layout.schemaVersion
            : HEXA_HIVE_LAYOUT_SCHEMA_VERSION,
        visibleCells: Array.isArray(layout.visibleCells)
            ? layout.visibleCells.map((cell) => ({
                q: Number.isInteger(cell?.q) ? cell.q : 0,
                r: Number.isInteger(cell?.r) ? cell.r : 0
            }))
            : [],
        filledCells: Array.isArray(layout.filledCells)
            ? layout.filledCells.map((cell) => ({
                q: Number.isInteger(cell?.q) ? cell.q : 0,
                r: Number.isInteger(cell?.r) ? cell.r : 0
            }))
            : [],
        visibleLocalCenters: Array.isArray(layout.visibleLocalCenters)
            ? layout.visibleLocalCenters.map((point) => ({
                x: Number.isFinite(point?.x) ? point.x : 0,
                y: Number.isFinite(point?.y) ? point.y : 0
            }))
            : [],
        filledLocalCenters: Array.isArray(layout.filledLocalCenters)
            ? layout.filledLocalCenters.map((point) => ({
                x: Number.isFinite(point?.x) ? point.x : 0,
                y: Number.isFinite(point?.y) ? point.y : 0
            }))
            : [],
        outlineVertices: Array.isArray(layout.outlineVertices)
            ? layout.outlineVertices.map((point) => ({
                x: Number.isFinite(point?.x) ? point.x : 0,
                y: Number.isFinite(point?.y) ? point.y : 0
            }))
            : [],
        collisionLocalParts: Array.isArray(layout.collisionLocalParts)
            ? layout.collisionLocalParts.map((part) => Array.isArray(part) ? [...part] : [])
            : []
    };
}

/**
 * 합체 적 외곽 루프를 이루는 선분을 순회합니다.
 * @param {object|null|undefined} layout
 * @param {(segment: {start: {x: number, y: number}, end: {x: number, y: number}}) => void} iteratee
 */
export function forEachHexaHiveOutlineSegment(layout, iteratee) {
    if (!layout || !Array.isArray(layout.outlineVertices) || layout.outlineVertices.length < 2 || typeof iteratee !== 'function') {
        return;
    }

    const vertices = layout.outlineVertices;
    for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        if (!start || !end) {
            continue;
        }

        iteratee({
            start: {
                x: Number.isFinite(start.x) ? start.x : 0,
                y: Number.isFinite(start.y) ? start.y : 0
            },
            end: {
                x: Number.isFinite(end.x) ? end.x : 0,
                y: Number.isFinite(end.y) ? end.y : 0
            }
        });
    }
}

/**
 * 적 인스턴스에서 현재 보이는 육각 조각의 월드 중심 목록을 추출합니다.
 * @param {object|null|undefined} enemy
 * @returns {{x: number, y: number}[]}
 */
export function collectHexaWorldCellsFromEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object' || !isHexaMergeEnemyType(enemy.type) || enemy.active === false) {
        return [];
    }

    const baseHeight = typeof enemy.getRenderHeightPx === 'function'
        ? enemy.getRenderHeightPx()
        : (Number.isFinite(enemy.renderHeightPx) ? enemy.renderHeightPx : 0);
    const positionX = Number.isFinite(enemy.position?.x) ? enemy.position.x : 0;
    const positionY = Number.isFinite(enemy.position?.y) ? enemy.position.y : 0;
    const rotationRadians = toRadians(enemy.rotation ?? 0);
    const worldCells = [];

    if (enemy.type === HEXA_HIVE_TYPE && enemy.hexaHiveLayout?.visibleLocalCenters?.length > 0 && baseHeight > EPSILON) {
        for (let i = 0; i < enemy.hexaHiveLayout.visibleLocalCenters.length; i++) {
            const localCenter = enemy.hexaHiveLayout.visibleLocalCenters[i];
            const rotated = rotatePoint(localCenter.x * baseHeight, localCenter.y * baseHeight, rotationRadians);
            worldCells.push({
                x: positionX + rotated.x,
                y: positionY + rotated.y
            });
        }
        return worldCells;
    }

    worldCells.push({ x: positionX, y: positionY });
    return worldCells;
}
