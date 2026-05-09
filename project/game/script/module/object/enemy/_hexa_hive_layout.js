import {
    EPSILON,
    HEXA_AXIAL_DIRECTIONS,
    HEXA_EXPOSED_EDGE_DIRECTIONS,
    HEXA_HIVE_BACKDROP_RENDER_SCALE,
    HEXA_HIVE_FRONT_RENDER_SCALE,
    HEXA_HIVE_LAYOUT_SCHEMA_VERSION,
    HEXA_HIVE_OUTLINE_THICKNESS_RATIO,
    HEXA_HIVE_TYPE,
    HEXA_LOCAL_VERTICES,
    HEXA_NORMALIZED_RADIUS,
    VERTEX_KEY_SCALE
} from './_hexa_hive_layout_constants.js';
import { normalizeDegrees, rotatePoint, toRadians } from 'util/math_util.js';

export {
    cloneHexaHiveLayout,
    collectHexaWorldCellsFromEnemy,
    forEachHexaHiveOutlineSegment
} from './_hexa_hive_layout_accessors.js';
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
 * 월드 셀 중심 목록을 hex-hive 레이아웃으로 변환합니다.
 * @param {{x: number, y: number}[]} worldCells
 * @param {{originX: number, originY: number, baseHeight: number, rotationDeg?: number}} options
 * @returns {{schemaVersion: number, visibleCells: {q: number, r: number}[], filledCells: {q: number, r: number}[], visibleLocalCenters: {x: number, y: number}[], filledLocalCenters: {x: number, y: number}[], outlineVertices: {x: number, y: number}[]}}
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
    const baseOutlineVertices = buildHexaOuterBoundaryVertices(filledCells);
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
        offsetLocalPoints(baseOutlineVertices, anchorPoint.x, anchorPoint.y),
        recenterOffsetX,
        recenterOffsetY
    );

    return {
        schemaVersion: HEXA_HIVE_LAYOUT_SCHEMA_VERSION,
        visibleCells: visibleCells.map((cell) => ({ q: cell.q, r: cell.r })),
        filledCells: filledCells.map((cell) => ({ q: cell.q, r: cell.r })),
        visibleLocalCenters,
        filledLocalCenters,
        outlineVertices
    };
}
