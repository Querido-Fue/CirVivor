import {
    buildEnemyAIFlowFieldForGridGoal
} from 'object/enemy/ai/_enemy_ai_navigation.js';
import { GPU_CIRCLE_BODY_FLOW } from '../physics/gpu/gpu_circle_body_abi.js';
import {
    ROUTE_GRAPH_NODE_KIND_CODE
} from '../contract/route_availability_contract.js';

export const ROUTE_FLOW_FIELD_MAX_LAYERS = GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT;
export const ROUTE_FLOW_FIELD_NO_NEXT_LAYER = -1;
export const ROUTE_FLOW_FIELD_GENERATION_VERSION = 2;

/**
 * @param {*} value - 검사할 값입니다.
 * @param {string} label - 오류 필드명입니다.
 * @returns {number} 양의 유한 숫자입니다.
 */
function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은(는) 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

/**
 * TileMap navigation/route snapshot을 검증합니다.
 * @param {*} tileMap - 검사할 TileMap compatible source입니다.
 * @returns {{grid:object,routes:object[],worldBounds:object}} 검증된 입력입니다.
 */
function readTileMapSnapshot(tileMap) {
    if (!tileMap
        || typeof tileMap.getNavigationGrid !== 'function'
        || typeof tileMap.getSpawnRoutes !== 'function'
        || typeof tileMap.getWorldBounds !== 'function') {
        throw new TypeError('route flow atlas에는 navigation/routes/world bounds source가 필요합니다.');
    }
    const grid = tileMap.getNavigationGrid();
    const routes = tileMap.getSpawnRoutes();
    const worldBounds = tileMap.getWorldBounds();
    const routeGraph = typeof tileMap.getRouteGraph === 'function'
        ? tileMap.getRouteGraph()
        : null;
    if (!Number.isInteger(grid?.cols)
        || !Number.isInteger(grid?.rows)
        || grid.cols <= 0
        || grid.rows <= 0
        || grid.size !== grid.cols * grid.rows
        || !(grid.blocked instanceof Uint8Array)
        || grid.blocked.length !== grid.size) {
        throw new TypeError('route flow atlas navigation grid 계약이 유효하지 않습니다.');
    }
    if (!Array.isArray(routes) || routes.length === 0) {
        throw new TypeError('route flow atlas에는 하나 이상의 spawn route가 필요합니다.');
    }
    let stageCount = 0;
    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        if (typeof route?.gateId !== 'string'
            || typeof route?.pathId !== 'string'
            || !Array.isArray(route?.waypoints)
            || route.waypoints.length < 2) {
            throw new TypeError(
                `spawn route 계약이 유효하지 않습니다: index=${routeIndex}`
            );
        }
        stageCount += route.waypoints.length - 1;
        if (stageCount > ROUTE_FLOW_FIELD_MAX_LAYERS) {
            throw new RangeError(
                `route flow stage는 ${ROUTE_FLOW_FIELD_MAX_LAYERS}개를 넘을 수 없습니다.`
            );
        }
    }
    if (routeGraph !== null
        && (!routeGraph || typeof routeGraph !== 'object')) {
        throw new TypeError('route flow atlas routeGraph는 object 또는 null이어야 합니다.');
    }
    return { grid, routes, worldBounds, routeGraph };
}

/**
 * 작은 deterministic FNV-1a content version을 갱신합니다.
 * @param {number} hash - 현재 hash입니다.
 * @param {number} byte - 추가할 byte입니다.
 * @returns {number} 갱신된 uint32 hash입니다.
 */
function hashByte(hash, byte) {
    return Math.imul((hash ^ (byte & 0xff)) >>> 0, 0x01000193) >>> 0;
}

function hashUint32(hash, value) {
    const uint32 = Number(value) >>> 0;
    let nextHash = hash;
    for (let byteIndex = 0;
        byteIndex < Uint32Array.BYTES_PER_ELEMENT;
        byteIndex++) {
        nextHash = hashByte(nextHash, uint32 >>> (byteIndex * 8));
    }
    return nextHash;
}

/**
 * route topology, authored float32 waypoint 위치와 blocked plane의 cache/debug key를 만듭니다.
 * @param {object} grid - navigation grid입니다.
 * @param {object[]} routes - 컴파일된 route입니다.
 * @returns {string} deterministic content key입니다.
 */
function createContentKey(grid, routes, compiledRouteGraph, stages, flowLayers) {
    let hash = 0x811c9dc5;
    const floatBits = new DataView(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT));
    for (let index = 0; index < grid.blocked.length; index++) {
        hash = hashByte(hash, grid.blocked[index]);
    }
    for (const route of routes) {
        const identity = `${route.gateId}\u0000${route.pathId}\u0000`;
        for (let index = 0; index < identity.length; index++) {
            const code = identity.charCodeAt(index);
            hash = hashByte(hash, code);
            hash = hashByte(hash, code >>> 8);
        }
        for (const waypoint of route.waypoints) {
            for (const value of [waypoint.row, waypoint.column]) {
                hash = hashByte(hash, value);
                hash = hashByte(hash, value >>> 8);
                hash = hashByte(hash, value >>> 16);
                hash = hashByte(hash, value >>> 24);
            }
            for (const value of [waypoint.x, waypoint.y]) {
                floatBits.setFloat32(0, value, true);
                for (let byteIndex = 0; byteIndex < Float32Array.BYTES_PER_ELEMENT; byteIndex++) {
                    hash = hashByte(hash, floatBits.getUint8(byteIndex));
                }
            }
        }
    }
    for (const stage of stages) {
        hash = hashUint32(hash, stage.sourceLayerIndex);
        hash = hashUint32(hash, stage.goalCell.column);
        hash = hashUint32(hash, stage.goalCell.row);
        hash = hashUint32(hash, stage.nextFieldIndex);
        floatBits.setFloat32(0, stage.transitionRadius, true);
        for (let byteIndex = 0;
            byteIndex < Float32Array.BYTES_PER_ELEMENT;
            byteIndex++) {
            hash = hashByte(hash, floatBits.getUint8(byteIndex));
        }
    }
    const generationIdentity = `gpu-route-flow-v${ROUTE_FLOW_FIELD_GENERATION_VERSION}`;
    for (let index = 0; index < generationIdentity.length; index++) {
        hash = hashByte(hash, generationIdentity.charCodeAt(index));
    }
    hash = hashUint32(hash, flowLayers.length);
    for (const layer of flowLayers) {
        hash = hashUint32(hash, layer.grid.cols);
        hash = hashUint32(hash, layer.grid.rows);
        floatBits.setFloat32(0, layer.grid.cellSize, true);
        for (let byteIndex = 0;
            byteIndex < Float32Array.BYTES_PER_ELEMENT;
            byteIndex++) {
            hash = hashByte(hash, floatBits.getUint8(byteIndex));
        }
        hash = hashUint32(hash, layer.goalCell.column);
        hash = hashUint32(hash, layer.goalCell.row);
        for (let index = 0; index < layer.grid.blocked.length; index++) {
            hash = hashByte(hash, layer.grid.blocked[index]);
        }
    }
    const graphIdentity = compiledRouteGraph === null
        ? '\u0000legacy-all-open'
        : JSON.stringify(compiledRouteGraph);
    for (let index = 0; index < graphIdentity.length; index++) {
        const code = graphIdentity.charCodeAt(index);
        hash = hashByte(hash, code);
        hash = hashByte(hash, code >>> 8);
    }
    return `${grid.cols}x${grid.rows}-${hash.toString(16).padStart(8, '0')}`;
}

function flowCellForPosition(position, grid, origin, label) {
    const column = Math.floor((Number(position?.x) - origin.x) / grid.cellSize);
    const row = Math.floor((Number(position?.y) - origin.y) / grid.cellSize);
    if (!Number.isInteger(column)
        || !Number.isInteger(row)
        || column < 0
        || column >= grid.cols
        || row < 0
        || row >= grid.rows) {
        throw new RangeError(`${label}가 route flow grid 범위를 벗어났습니다.`);
    }
    return Object.freeze({ column, row });
}

function hashBlockedPlane(blocked) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < blocked.length; index++) {
        hash = hashByte(hash, blocked[index]);
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * TileMap은 macro route cell을 GPU flow 해상도로 사용합니다. 일반 navigation
 * source(benchmark/fixture)는 기존 1-cell grid를 그대로 유지합니다.
 */
function createRouteFlowLayerSource(
    tileMap,
    baseGrid,
    routes,
    worldBounds,
    routeGraph
) {
    const origin = Object.freeze({
        x: Number(worldBounds?.minX ?? 0),
        y: Number(worldBounds?.minY ?? 0)
    });
    const pathWidthTiles = typeof tileMap.getPathWidthTiles === 'function'
        ? Number(tileMap.getPathWidthTiles())
        : null;
    const usesMacroRouteGrid = Number.isInteger(pathWidthTiles)
        && pathWidthTiles > 1;
    const flowCellSize = usesMacroRouteGrid
        ? baseGrid.cellSize * pathWidthTiles
        : baseGrid.cellSize;
    const cols = usesMacroRouteGrid
        ? baseGrid.cols / pathWidthTiles
        : baseGrid.cols;
    const rows = usesMacroRouteGrid
        ? baseGrid.rows / pathWidthTiles
        : baseGrid.rows;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)
        || cols <= 0 || rows <= 0) {
        throw new RangeError('route flow macro grid는 navigation grid를 정확히 나눠야 합니다.');
    }
    const size = cols * rows;
    const layerIndicesByKey = new Map();
    const layers = [];
    const routeStageLayerIndices = new Array(routes.length);
    const routeCells = new Array(routes.length);
    const routeIndexByPathId = new Map(
        routes.map((route, routeIndex) => [route.pathId, routeIndex])
    );
    const routeSetIndexByPathId = new Map();
    if (routeGraph !== null) {
        for (let routeSetIndex = 0;
            routeSetIndex < routeGraph.routeSets.length;
            routeSetIndex++) {
            for (const candidate of routeGraph.routeSets[routeSetIndex].candidates) {
                routeSetIndexByPathId.set(candidate.pathId, routeSetIndex);
            }
        }
    }

    const validateRouteCells = (route, cells, blocked) => {
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
            const cell = cells[cellIndex];
            if (blocked[(cell.row * cols) + cell.column] !== 0) {
                throw new RangeError(
                    `route waypoint는 보행 가능한 flow cell이어야 합니다: ${route.pathId}/${cellIndex}`
                );
            }
            if (!usesMacroRouteGrid || cellIndex === 0) {
                continue;
            }
            const previous = cells[cellIndex - 1];
            const deltaColumn = Math.abs(cell.column - previous.column);
            const deltaRow = Math.abs(cell.row - previous.row);
            if (Math.max(deltaColumn, deltaRow) !== 1) {
                throw new RangeError(
                    `macro route waypoint는 인접 flow cell이어야 합니다: ${route.pathId}/${cellIndex}`
                );
            }
            if (deltaColumn !== 0 && deltaRow !== 0) {
                const horizontalIndex = (previous.row * cols) + cell.column;
                const verticalIndex = (cell.row * cols) + previous.column;
                if (blocked[horizontalIndex] !== 0
                    || blocked[verticalIndex] !== 0) {
                    throw new RangeError(
                        `macro route 대각선은 corner-cut 없이 연결되어야 합니다: ${route.pathId}/${cellIndex}`
                    );
                }
            }
        }
    };

    const validateRouteReachability = (route, cells, stageLayerIndices) => {
        const uniqueLayerIndices = new Set(stageLayerIndices);
        for (const layerIndex of uniqueLayerIndices) {
            const integration = layers[layerIndex].field.integration;
            for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
                const cell = cells[cellIndex];
                const cost = integration[(cell.row * cols) + cell.column];
                if (!Number.isFinite(cost) || cost >= 1e19) {
                    throw new RangeError(
                        `route waypoint가 flow goal에 도달할 수 없습니다: ${route.pathId}/${cellIndex}`
                    );
                }
            }
        }
    };

    const blockedPlanesEqual = (left, right) => {
        if (left.length !== right.length) {
            return false;
        }
        for (let index = 0; index < left.length; index++) {
            if (left[index] !== right[index]) {
                return false;
            }
        }
        return true;
    };
    const ensureLayer = (blocked, goalCell, routeSetIndex) => {
        const layerKey = `${routeSetIndex}:${goalCell.row}:${goalCell.column}:${hashBlockedPlane(blocked)}`;
        const candidateIndices = layerIndicesByKey.get(layerKey) ?? [];
        for (const candidateIndex of candidateIndices) {
            if (blockedPlanesEqual(layers[candidateIndex].grid.blocked, blocked)) {
                return candidateIndex;
            }
        }
        const grid = Object.freeze({
            cols,
            rows,
            size,
            cellSize: flowCellSize,
            blocked
        });
        const field = buildEnemyAIFlowFieldForGridGoal(
            grid,
            { cx: goalCell.column, cy: goalCell.row }
        );
        if (!(field?.dirX instanceof Float32Array)
            || !(field?.dirY instanceof Float32Array)
            || !(field?.integration instanceof Float32Array)
            || field.dirX.length !== size
            || field.dirY.length !== size
            || field.integration.length !== size) {
            throw new TypeError('JS/WASM route flow fallback plane 계약이 유효하지 않습니다.');
        }
        const layerIndex = layers.length;
        layers.push(Object.freeze({
            layerIndex,
            grid,
            goalCell,
            routeSetIndex,
            field,
            walkableCellCount: blocked.reduce(
                (count, value) => count + Number(value === 0),
                0
            )
        }));
        candidateIndices.push(layerIndex);
        layerIndicesByKey.set(layerKey, candidateIndices);
        return layerIndex;
    };

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        routeCells[routeIndex] = Object.freeze(route.waypoints.map(
            (waypoint, waypointIndex) => (
            flowCellForPosition(
                waypoint,
                { cols, rows, cellSize: flowCellSize },
                origin,
                `route ${route.pathId}/${waypointIndex}`
            )
        )));
    }

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        const cells = routeCells[routeIndex];
        const routeSetIndex = routeSetIndexByPathId.get(route.pathId) ?? -1;
        const blocked = usesMacroRouteGrid
            ? new Uint8Array(size).fill(1)
            : baseGrid.blocked.slice();
        if (usesMacroRouteGrid) {
            const routeSet = routeSetIndex >= 0
                ? routeGraph.routeSets[routeSetIndex]
                : null;
            const walkableRouteIndices = routeSet === null
                ? [routeIndex]
                : routeSet.candidates.map((candidate) => {
                    const candidateRouteIndex = routeIndexByPathId.get(
                        candidate.pathId
                    );
                    if (candidateRouteIndex === undefined) {
                        throw new RangeError(
                            `routeSet candidate route가 없습니다: ${candidate.pathId}`
                        );
                    }
                    return candidateRouteIndex;
                });
            for (const walkableRouteIndex of walkableRouteIndices) {
                for (const cell of routeCells[walkableRouteIndex]) {
                    blocked[(cell.row * cols) + cell.column] = 0;
                }
            }
        }
        validateRouteCells(route, cells, blocked);
        const seenCells = new Set();
        let hasRepeatedCell = false;
        for (const cell of cells) {
            const cellKey = `${cell.row}:${cell.column}`;
            if (seenCells.has(cellKey)) {
                hasRepeatedCell = true;
            }
            seenCells.add(cellKey);
        }
        const stageLayerIndices = new Uint32Array(cells.length - 1);
        if (hasRepeatedCell) {
            // A scalar integration field cannot encode ordered traversal through
            // a self-intersection. Keep a compact goal field per distinct stage
            // goal only for those routes; ordinary non-self-intersecting routes
            // still use one final-goal source regardless of stage count.
            for (let waypointIndex = 1;
                waypointIndex < cells.length;
                waypointIndex++) {
                stageLayerIndices[waypointIndex - 1]
                    = ensureLayer(blocked, cells[waypointIndex], routeSetIndex);
            }
        } else {
            stageLayerIndices.fill(ensureLayer(
                blocked,
                cells[cells.length - 1],
                routeSetIndex
            ));
        }
        validateRouteReachability(route, cells, stageLayerIndices);
        routeStageLayerIndices[routeIndex] = stageLayerIndices;
    }
    return Object.freeze({
        cols,
        rows,
        size,
        cellSize: flowCellSize,
        origin,
        usesMacroRouteGrid,
        layers: Object.freeze(layers),
        routeStageLayerIndices: Object.freeze(routeStageLayerIndices),
        routeCells: Object.freeze(routeCells)
    });
}

function compareStrings(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function requireCompiledFieldIndex(route, waypointIndex, label) {
    if (!Number.isInteger(waypointIndex)
        || waypointIndex < 0
        || waypointIndex > route.fieldCount) {
        throw new RangeError(`${label} waypoint가 compiled flow 범위를 벗어났습니다.`);
    }
    return waypointIndex === 0
        ? ROUTE_FLOW_FIELD_NO_NEXT_LAYER
        : route.firstFieldIndex + waypointIndex - 1;
}

/** optional authored graph를 GPU/endpoint가 공유할 compact numeric topology로 바꿉니다. */
function compileRouteGraph(routeGraph, compiledRoutes, physicalBlocking) {
    if (routeGraph === null) {
        return null;
    }
    const pathIndexById = new Map();
    const paths = compiledRoutes.map((route, pathIndex) => {
        if (pathIndexById.has(route.pathId)) {
            throw new RangeError(`compiled route pathId가 중복되었습니다: ${route.pathId}`);
        }
        pathIndexById.set(route.pathId, pathIndex);
        return Object.freeze({
            pathIndex,
            pathId: route.pathId,
            routeIndex: pathIndex,
            firstFieldIndex: route.firstFieldIndex,
            fieldCount: route.fieldCount
        });
    });

    const routeCandidates = [];
    const routeSets = [];
    const routeSetIndexByPathIndex = new Map();
    for (let routeSetIndex = 0;
        routeSetIndex < routeGraph.routeSets.length;
        routeSetIndex++) {
        const routeSet = routeGraph.routeSets[routeSetIndex];
        const orderedCandidates = [...routeSet.candidates].sort((left, right) => (
            left.priority - right.priority
            || compareStrings(left.pathId, right.pathId)
        ));
        const candidateOffset = routeCandidates.length;
        for (const candidate of orderedCandidates) {
            const pathIndex = pathIndexById.get(candidate.pathId);
            if (pathIndex === undefined) {
                throw new RangeError(
                    `routeGraph candidate path가 compiled route에 없습니다: ${candidate.pathId}`
                );
            }
            if (routeSetIndexByPathIndex.has(pathIndex)) {
                throw new RangeError(
                    `각 path는 정확히 하나의 routeSet candidate여야 합니다: ${candidate.pathId}`
                );
            }
            routeSetIndexByPathIndex.set(pathIndex, routeSetIndex);
            routeCandidates.push(Object.freeze({
                pathIndex,
                priority: candidate.priority
            }));
        }
        routeSets.push(Object.freeze({
            routeSetIndex,
            id: routeSet.id,
            candidateOffset,
            candidateCount: orderedCandidates.length
        }));
    }
    if (routeSetIndexByPathIndex.size !== paths.length) {
        const missing = paths.find((path) => (
            !routeSetIndexByPathIndex.has(path.pathIndex)
        ));
        throw new RangeError(
            `각 compiled path는 정확히 하나의 routeSet에 속해야 합니다: ${missing?.pathId}`
        );
    }

    const memberships = [];
    const nodes = [];
    const nodeIndexById = new Map();
    for (let nodeIndex = 0; nodeIndex < routeGraph.nodes.length; nodeIndex++) {
        const node = routeGraph.nodes[nodeIndex];
        const kindCode = ROUTE_GRAPH_NODE_KIND_CODE[node.kind];
        if (!Number.isInteger(kindCode)) {
            throw new RangeError(`routeGraph node kind code가 없습니다: ${node.kind}`);
        }
        const membershipOffset = memberships.length;
        const orderedMemberships = [...node.memberships].sort((left, right) => (
            pathIndexById.get(left.pathId) - pathIndexById.get(right.pathId)
        ));
        for (const membership of orderedMemberships) {
            const pathIndex = pathIndexById.get(membership.pathId);
            if (pathIndex === undefined) {
                throw new RangeError(
                    `routeGraph membership path가 compiled route에 없습니다: ${membership.pathId}`
                );
            }
            const route = compiledRoutes[pathIndex];
            memberships.push(Object.freeze({
                pathIndex,
                waypointIndex: membership.waypointIndex,
                progressOrdinal: membership.progressOrdinal,
                fieldIndex: requireCompiledFieldIndex(
                    route,
                    membership.waypointIndex,
                    `routeGraph node ${node.id}`
                )
            }));
        }
        if (nodeIndexById.has(node.id)) {
            throw new RangeError(`routeGraph node ID가 중복되었습니다: ${node.id}`);
        }
        nodeIndexById.set(node.id, nodeIndex);
        nodes.push(Object.freeze({
            nodeIndex,
            id: node.id,
            kindCode,
            membershipOffset,
            membershipCount: orderedMemberships.length
        }));
    }

    const transitions = [];
    const switches = [];
    for (let switchIndex = 0;
        switchIndex < routeGraph.switches.length;
        switchIndex++) {
        const routeSwitch = routeGraph.switches[switchIndex];
        const nodeIndex = nodeIndexById.get(routeSwitch.nodeId);
        if (nodeIndex === undefined) {
            throw new RangeError(`routeGraph switch node가 없습니다: ${routeSwitch.nodeId}`);
        }
        const transitionOffset = transitions.length;
        const orderedTransitions = [...routeSwitch.transitions].sort((left, right) => (
            pathIndexById.get(left.fromPathId) - pathIndexById.get(right.fromPathId)
            || left.priority - right.priority
            || compareStrings(left.toPathId, right.toPathId)
        ));
        for (const transition of orderedTransitions) {
            const fromPathIndex = pathIndexById.get(transition.fromPathId);
            const toPathIndex = pathIndexById.get(transition.toPathId);
            if (fromPathIndex === undefined || toPathIndex === undefined) {
                throw new RangeError('routeGraph transition path가 compiled route에 없습니다.');
            }
            if (routeSetIndexByPathIndex.get(fromPathIndex)
                !== routeSetIndexByPathIndex.get(toPathIndex)) {
                throw new RangeError(
                    'routeGraph switch transition은 같은 routeSet 안에서만 이동해야 합니다.'
                );
            }
            transitions.push(Object.freeze({
                fromPathIndex,
                toPathIndex,
                targetWaypointIndex: transition.targetWaypointIndex,
                targetFieldIndex: requireCompiledFieldIndex(
                    compiledRoutes[toPathIndex],
                    transition.targetWaypointIndex,
                    `routeGraph switch ${routeSwitch.id}`
                ),
                priority: transition.priority
            }));
        }
        switches.push(Object.freeze({
            switchIndex,
            id: routeSwitch.id,
            nodeIndex,
            transitionOffset,
            transitionCount: orderedTransitions.length
        }));
    }

    const closures = routeGraph.closures.map((closure, closureIndex) => {
        const pathIndex = pathIndexById.get(closure.pathId);
        const entranceNodeIndex = nodeIndexById.get(closure.entranceNodeId);
        const clearanceNodeIndex = nodeIndexById.get(closure.clearanceNodeId);
        const upstreamSwitchNodeIndex = nodeIndexById.get(
            closure.upstreamSwitchNodeId
        );
        const downstreamMergeNodeIndex = nodeIndexById.get(
            closure.downstreamMergeNodeId
        );
        if (pathIndex === undefined
            || !routeSetIndexByPathIndex.has(pathIndex)
            || entranceNodeIndex === undefined
            || clearanceNodeIndex === undefined
            || upstreamSwitchNodeIndex === undefined
            || downstreamMergeNodeIndex === undefined) {
            throw new RangeError(`routeGraph closure topology가 불완전합니다: ${closure.id}`);
        }
        const membershipFor = (nodeIndex) => {
            const node = routeGraph.nodes[nodeIndex];
            return node.memberships.find(
                (membership) => membership.pathId === closure.pathId
            );
        };
        const entrance = membershipFor(entranceNodeIndex);
        const clearance = membershipFor(clearanceNodeIndex);
        return Object.freeze({
            closureIndex,
            id: closure.id,
            physicalBlocking,
            pathIndex,
            entranceNodeIndex,
            clearanceNodeIndex,
            upstreamSwitchNodeIndex,
            downstreamMergeNodeIndex,
            entranceFieldIndex: requireCompiledFieldIndex(
                compiledRoutes[pathIndex],
                entrance.waypointIndex,
                `routeGraph closure ${closure.id}.entrance`
            ),
            clearanceFieldIndex: requireCompiledFieldIndex(
                compiledRoutes[pathIndex],
                clearance.waypointIndex,
                `routeGraph closure ${closure.id}.clearance`
            ),
            priority: closure.priority
        });
    });

    return Object.freeze({
        version: routeGraph.version,
        paths: Object.freeze(paths),
        routeSets: Object.freeze(routeSets),
        routeCandidates: Object.freeze(routeCandidates),
        nodes: Object.freeze(nodes),
        memberships: Object.freeze(memberships),
        switches: Object.freeze(switches),
        transitions: Object.freeze(transitions),
        closures: Object.freeze(closures)
    });
}

/**
 * 자기 교차가 없는 물리 route의 waypoint stage를 하나의 route-wide source로
 * 컴파일합니다. 자기 교차 route는 순서가 없는 scalar field의 shortcut을 막기 위해
 * distinct stage goal source만 유지합니다. 실제 GPU는 `gpuGeneration`의
 * seed→relax→finalize recipe로 source를 만들고 stage layer에 복제합니다. JS/WASM
 * plane은 결정적 fallback/oracle입니다. 중간 전이는 integration cost를 사용하므로
 * 넓은 통로를 waypoint 중심으로 압축하지 않습니다.
 * @param {object} tileMap - 현재 TileMap입니다.
 * @returns {object} immutable metadata와 caller-owned fallback plane입니다.
 */
export function createRouteFlowFieldAtlas(tileMap) {
    const {
        grid: navigationGrid,
        routes,
        worldBounds,
        routeGraph
    } = readTileMapSnapshot(tileMap);
    const navigationCellSize = requirePositiveFinite(
        navigationGrid.cellSize,
        'navigationGrid.cellSize'
    );
    const flowSource = createRouteFlowLayerSource(
        tileMap,
        navigationGrid,
        routes,
        worldBounds,
        routeGraph
    );
    const defaultTransitionRadius = navigationCellSize * 0.75;
    const authoredTransitionRadius = typeof tileMap.getFlowTransitionRadius
        === 'function'
        ? tileMap.getFlowTransitionRadius()
        : null;
    const intermediateTransitionRadius = authoredTransitionRadius === null
        || authoredTransitionRadius === undefined
        ? defaultTransitionRadius
        : requirePositiveFinite(
            authoredTransitionRadius,
            'flowTransitionRadiusTiles'
        );
    const routeClosurePhysicalBlocking
        = typeof tileMap.getRouteClosurePhysicalBlocking === 'function'
            ? tileMap.getRouteClosurePhysicalBlocking()
            : true;
    if (typeof routeClosurePhysicalBlocking !== 'boolean') {
        throw new TypeError('route closure physical-blocking policy가 boolean이어야 합니다.');
    }
    const pendingStages = [];
    const compiledRoutes = [];

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        const firstFieldIndex = pendingStages.length;
        const fieldIndices = [];
        for (let waypointIndex = 1; waypointIndex < route.waypoints.length; waypointIndex++) {
            const waypoint = route.waypoints[waypointIndex];
            const flowCell = flowSource.routeCells[routeIndex][waypointIndex];
            const column = flowCell.column;
            const row = flowCell.row;
            const goalX = Number(waypoint?.x);
            const goalY = Number(waypoint?.y);
            if (!Number.isInteger(column)
                || !Number.isInteger(row)
                || column < 0
                || column >= flowSource.cols
                || row < 0
                || row >= flowSource.rows) {
                throw new RangeError(
                    `route waypoint는 보행 가능한 navigation cell이어야 합니다: ${route.pathId}/${waypointIndex}`
                );
            }
            if (!Number.isFinite(goalX)
                || !Number.isFinite(goalY)
                || !Number.isFinite(Math.fround(goalX))
                || !Number.isFinite(Math.fround(goalY))) {
                throw new RangeError(
                    `route waypoint world 위치는 유한한 float32여야 합니다: ${route.pathId}/${waypointIndex}`
                );
            }
            if (pendingStages.length >= ROUTE_FLOW_FIELD_MAX_LAYERS) {
                throw new RangeError(
                    `route flow stage는 ${ROUTE_FLOW_FIELD_MAX_LAYERS}개를 넘을 수 없습니다.`
                );
            }
            const fieldIndex = pendingStages.length;
            pendingStages.push({
                sourceLayerIndex:
                    flowSource.routeStageLayerIndices[routeIndex][waypointIndex - 1],
                pathId: route.pathId,
                waypointIndex,
                goalCell: Object.freeze({ column, row }),
                goalPosition: Object.freeze({
                    x: goalX,
                    y: goalY
                }),
                nextFieldIndex: ROUTE_FLOW_FIELD_NO_NEXT_LAYER,
                transitionRadius: waypointIndex + 1 < route.waypoints.length
                    ? intermediateTransitionRadius
                    : defaultTransitionRadius
            });
            fieldIndices.push(fieldIndex);
        }
        for (let index = 0; index + 1 < fieldIndices.length; index++) {
            pendingStages[fieldIndices[index]].nextFieldIndex = fieldIndices[index + 1];
        }
        compiledRoutes.push(Object.freeze({
            gateId: route.gateId,
            pathId: route.pathId,
            firstFieldIndex,
            fieldCount: fieldIndices.length,
            firstTargetWaypointIndex: 1,
            fieldIndices: Object.freeze(fieldIndices)
        }));
    }

    const directions = new Float32Array(
        pendingStages.length * flowSource.size * 2
    );
    const integrationCosts = new Float32Array(
        pendingStages.length * flowSource.size
    );
    const stageLayerIndices = new Uint32Array(pendingStages.length);
    const stages = pendingStages.map((pending, fieldIndex) => {
        const sourceLayer = flowSource.layers[pending.sourceLayerIndex];
        const layerOffset = fieldIndex * flowSource.size * 2;
        const integrationLayerOffset = fieldIndex * flowSource.size;
        for (let cellIndex = 0; cellIndex < flowSource.size; cellIndex++) {
            directions[layerOffset + (cellIndex * 2)]
                = sourceLayer.field.dirX[cellIndex];
            directions[layerOffset + (cellIndex * 2) + 1]
                = sourceLayer.field.dirY[cellIndex];
            integrationCosts[integrationLayerOffset + cellIndex]
                = sourceLayer.field.integration[cellIndex];
        }
        stageLayerIndices[fieldIndex] = pending.sourceLayerIndex;
        return Object.freeze({
            pathId: pending.pathId,
            waypointIndex: pending.waypointIndex,
            sourceLayerIndex: pending.sourceLayerIndex,
            goalCell: pending.goalCell,
            goalPosition: pending.goalPosition,
            goalIndex: (pending.goalCell.row * flowSource.cols)
                + pending.goalCell.column,
            nextFieldIndex: pending.nextFieldIndex,
            transitionRadius: pending.transitionRadius
        });
    });
    const compiledRouteGraph = compileRouteGraph(
        routeGraph,
        compiledRoutes,
        routeClosurePhysicalBlocking
    );

    const blockedLayers = new Uint32Array(
        flowSource.layers.length * flowSource.size
    );
    const goalCellIndices = new Uint32Array(flowSource.layers.length);
    const sourceLayerRouteSetIndices = new Uint32Array(flowSource.layers.length);
    sourceLayerRouteSetIndices.fill(0xffffffff);
    let relaxationPassCount = 1;
    for (const layer of flowSource.layers) {
        const layerOffset = layer.layerIndex * flowSource.size;
        for (let cellIndex = 0; cellIndex < flowSource.size; cellIndex++) {
            blockedLayers[layerOffset + cellIndex]
                = layer.grid.blocked[cellIndex] === 0 ? 0 : 1;
        }
        goalCellIndices[layer.layerIndex]
            = (layer.goalCell.row * flowSource.cols) + layer.goalCell.column;
        if (layer.routeSetIndex >= 0) {
            sourceLayerRouteSetIndices[layer.layerIndex] = layer.routeSetIndex;
        }
        relaxationPassCount = Math.max(
            relaxationPassCount,
            layer.walkableCellCount
        );
    }
    const closureCount = compiledRouteGraph?.closures.length ?? 0;
    const closureBlockCellIndices = new Uint32Array(closureCount);
    const closureRouteSetIndices = new Uint32Array(closureCount);
    const routeSetCoreGoalCellIndices = new Uint32Array(
        compiledRouteGraph?.routeSets.length ?? 0
    );
    if (compiledRouteGraph !== null) {
        const routeSetIndexByPathIndex = new Map();
        for (const routeSet of compiledRouteGraph.routeSets) {
            for (let candidateIndex = routeSet.candidateOffset;
                candidateIndex < routeSet.candidateOffset + routeSet.candidateCount;
                candidateIndex++) {
                routeSetIndexByPathIndex.set(
                    compiledRouteGraph.routeCandidates[candidateIndex].pathIndex,
                    routeSet.routeSetIndex
                );
            }
            let commonCoreGoalCellIndex = null;
            for (let candidateIndex = routeSet.candidateOffset;
                candidateIndex < routeSet.candidateOffset + routeSet.candidateCount;
                candidateIndex++) {
                const candidate
                    = compiledRouteGraph.routeCandidates[candidateIndex];
                const candidateRoute = compiledRoutes[candidate.pathIndex];
                const finalFieldIndex = candidateRoute.firstFieldIndex
                    + candidateRoute.fieldCount - 1;
                const coreGoalCellIndex = stages[finalFieldIndex]?.goalIndex;
                if (!Number.isSafeInteger(coreGoalCellIndex)
                    || (commonCoreGoalCellIndex !== null
                        && commonCoreGoalCellIndex !== coreGoalCellIndex)) {
                    throw new RangeError(
                        `routeSet ${routeSet.id}의 candidate Core goal이 일치하지 않습니다.`
                    );
                }
                commonCoreGoalCellIndex ??= coreGoalCellIndex;
            }
            routeSetCoreGoalCellIndices[routeSet.routeSetIndex]
                = commonCoreGoalCellIndex;
        }
        for (const closure of compiledRouteGraph.closures) {
            closureBlockCellIndices[closure.closureIndex]
                = stages[closure.entranceFieldIndex].goalIndex;
            closureRouteSetIndices[closure.closureIndex]
                = routeSetIndexByPathIndex.get(closure.pathIndex);
        }
    }
    const gpuGeneration = Object.freeze({
        version: ROUTE_FLOW_FIELD_GENERATION_VERSION,
        sourceLayerCount: flowSource.layers.length,
        stageLayerIndices,
        blockedLayers,
        goalCellIndices,
        sourceLayerRouteSetIndices,
        closureBlockCellIndices,
        closureRouteSetIndices,
        routeSetCoreGoalCellIndices,
        relaxationPassCount
    });

    return Object.freeze({
        contentKey: createContentKey(
            navigationGrid,
            routes,
            compiledRouteGraph,
            stages,
            flowSource.layers
        ),
        cols: flowSource.cols,
        rows: flowSource.rows,
        size: flowSource.size,
        cellSize: flowSource.cellSize,
        origin: flowSource.origin,
        fieldCount: stages.length,
        sourceLayerCount: flowSource.layers.length,
        directions,
        integrationCosts,
        gpuGeneration,
        stages: Object.freeze(stages),
        routes: Object.freeze(compiledRoutes),
        routeGraph: compiledRouteGraph
    });
}

/**
 * 현재 closure snapshot을 반영한 GPU rebuild recipe를 만듭니다. 기존 atlas와
 * 활성 texture는 건드리지 않으며, 같은 route-set의 모든 source layer에 실제
 * 마개 cell을 obstacle로 추가합니다.
 */
export function createRouteFlowFieldRebuildAtlas(
    atlas,
    closedClosureIndices
) {
    if (!atlas?.routeGraph || !atlas?.gpuGeneration) {
        return atlas;
    }
    const closed = [...closedClosureIndices];
    const generation = atlas.gpuGeneration;
    const blockedLayers = generation.blockedLayers.slice();
    const goalCellIndices = generation.goalCellIndices.slice();
    const seen = new Set();
    const affectedRouteSetIndices = new Set();
    for (const rawClosureIndex of closed) {
        const closureIndex = Number(rawClosureIndex);
        if (!Number.isSafeInteger(closureIndex)
            || closureIndex < 0
            || closureIndex >= generation.closureBlockCellIndices.length
            || seen.has(closureIndex)) {
            throw new RangeError('flow rebuild closure index가 유효하지 않습니다.');
        }
        seen.add(closureIndex);
        const routeSetIndex = generation.closureRouteSetIndices[closureIndex];
        affectedRouteSetIndices.add(routeSetIndex);
    }
    for (let layerIndex = 0;
        layerIndex < generation.sourceLayerCount;
        layerIndex++) {
        const routeSetIndex
            = generation.sourceLayerRouteSetIndices[layerIndex];
        if (affectedRouteSetIndices.has(routeSetIndex)) {
            goalCellIndices[layerIndex]
                = generation.routeSetCoreGoalCellIndices[routeSetIndex];
        }
    }
    for (const closureIndex of seen) {
        const routeSetIndex = generation.closureRouteSetIndices[closureIndex];
        const blockedCellIndex
            = generation.closureBlockCellIndices[closureIndex];
        for (let layerIndex = 0;
            layerIndex < generation.sourceLayerCount;
            layerIndex++) {
            if (generation.sourceLayerRouteSetIndices[layerIndex]
                !== routeSetIndex) {
                continue;
            }
            if (goalCellIndices[layerIndex] === blockedCellIndex) {
                throw new RangeError(
                    'closure obstacle과 flow goal이 같은 cell일 수 없습니다.'
                );
            }
            blockedLayers[(layerIndex * atlas.size) + blockedCellIndex] = 1;
        }
    }
    return Object.freeze({
        ...atlas,
        gpuGeneration: Object.freeze({
            ...generation,
            blockedLayers,
            goalCellIndices
        })
    });
}
