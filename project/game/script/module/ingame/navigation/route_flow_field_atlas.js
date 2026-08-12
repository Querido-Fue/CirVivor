import {
    buildEnemyAIFlowFieldForGridGoal
} from 'object/enemy/ai/_enemy_ai_navigation.js';
import { GPU_CIRCLE_BODY_FLOW } from '../physics/gpu/gpu_circle_body_abi.js';
import {
    ROUTE_GRAPH_NODE_KIND_CODE
} from '../contract/route_availability_contract.js';

export const ROUTE_FLOW_FIELD_MAX_LAYERS = GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT;
export const ROUTE_FLOW_FIELD_NO_NEXT_LAYER = -1;

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

/**
 * route topology, authored float32 waypoint 위치와 blocked plane의 cache/debug key를 만듭니다.
 * @param {object} grid - navigation grid입니다.
 * @param {object[]} routes - 컴파일된 route입니다.
 * @returns {string} deterministic content key입니다.
 */
function createContentKey(grid, routes, compiledRouteGraph) {
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
function compileRouteGraph(routeGraph, compiledRoutes) {
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
 * 현재 JS/WASM flow-field 결과를 route waypoint별 GPU texture layer로 컴파일합니다.
 * layer texel은 `RG = direction`, stage metadata는 flow 생성용 goal cell과 GPU
 * 전환용 authored goal position 및 다음 layer를 보유합니다.
 * 첫 waypoint는 spawn 위치이므로 각 route의 첫 field는 waypoint index 1을 목표로 합니다.
 * @param {object} tileMap - 현재 TileMap입니다.
 * @returns {object} immutable metadata와 caller-owned Float32 direction plane입니다.
 */
export function createRouteFlowFieldAtlas(tileMap) {
    const { grid, routes, worldBounds, routeGraph } = readTileMapSnapshot(tileMap);
    const cellSize = requirePositiveFinite(grid.cellSize, 'navigationGrid.cellSize');
    const pendingFields = [];
    const compiledRoutes = [];

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
        const route = routes[routeIndex];
        if (typeof route?.gateId !== 'string'
            || typeof route?.pathId !== 'string'
            || !Array.isArray(route?.waypoints)
            || route.waypoints.length < 2) {
            throw new TypeError(`spawn route 계약이 유효하지 않습니다: index=${routeIndex}`);
        }
        const firstFieldIndex = pendingFields.length;
        const fieldIndices = [];
        for (let waypointIndex = 1; waypointIndex < route.waypoints.length; waypointIndex++) {
            const waypoint = route.waypoints[waypointIndex];
            const column = waypoint?.column;
            const row = waypoint?.row;
            const goalX = Number(waypoint?.x);
            const goalY = Number(waypoint?.y);
            if (!Number.isInteger(column)
                || !Number.isInteger(row)
                || column < 0
                || column >= grid.cols
                || row < 0
                || row >= grid.rows
                || grid.blocked[(row * grid.cols) + column] !== 0) {
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
            if (pendingFields.length >= ROUTE_FLOW_FIELD_MAX_LAYERS) {
                throw new RangeError(
                    `route flow layer는 ${ROUTE_FLOW_FIELD_MAX_LAYERS}개를 넘을 수 없습니다.`
                );
            }
            const fieldIndex = pendingFields.length;
            const field = buildEnemyAIFlowFieldForGridGoal(
                grid,
                { cx: column, cy: row }
            );
            if (!(field?.dirX instanceof Float32Array)
                || !(field?.dirY instanceof Float32Array)
                || !(field?.integration instanceof Float32Array)
                || field.dirX.length !== grid.size
                || field.dirY.length !== grid.size
                || field.integration.length !== grid.size) {
                throw new TypeError('JS/WASM flow-field 방향/integration plane 계약이 유효하지 않습니다.');
            }
            pendingFields.push({
                field,
                pathId: route.pathId,
                waypointIndex,
                goalCell: Object.freeze({ column, row }),
                goalPosition: Object.freeze({
                    x: goalX,
                    y: goalY
                }),
                nextFieldIndex: ROUTE_FLOW_FIELD_NO_NEXT_LAYER
            });
            fieldIndices.push(fieldIndex);
        }
        for (let index = 0; index + 1 < fieldIndices.length; index++) {
            pendingFields[fieldIndices[index]].nextFieldIndex = fieldIndices[index + 1];
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

    const directions = new Float32Array(pendingFields.length * grid.size * 2);
    const integrationCosts = new Float32Array(pendingFields.length * grid.size);
    const stages = pendingFields.map((pending, fieldIndex) => {
        const layerOffset = fieldIndex * grid.size * 2;
        const integrationLayerOffset = fieldIndex * grid.size;
        for (let cellIndex = 0; cellIndex < grid.size; cellIndex++) {
            directions[layerOffset + (cellIndex * 2)] = pending.field.dirX[cellIndex];
            directions[layerOffset + (cellIndex * 2) + 1] = pending.field.dirY[cellIndex];
            integrationCosts[integrationLayerOffset + cellIndex]
                = pending.field.integration[cellIndex];
        }
        return Object.freeze({
            pathId: pending.pathId,
            waypointIndex: pending.waypointIndex,
            goalCell: pending.goalCell,
            goalPosition: pending.goalPosition,
            goalIndex: (pending.goalCell.row * grid.cols) + pending.goalCell.column,
            nextFieldIndex: pending.nextFieldIndex
        });
    });
    const compiledRouteGraph = compileRouteGraph(routeGraph, compiledRoutes);

    return Object.freeze({
        contentKey: createContentKey(grid, routes, compiledRouteGraph),
        cols: grid.cols,
        rows: grid.rows,
        size: grid.size,
        cellSize,
        origin: Object.freeze({
            x: Number(worldBounds?.minX ?? 0),
            y: Number(worldBounds?.minY ?? 0)
        }),
        fieldCount: stages.length,
        directions,
        integrationCosts,
        stages: Object.freeze(stages),
        routes: Object.freeze(compiledRoutes),
        routeGraph: compiledRouteGraph
    });
}
