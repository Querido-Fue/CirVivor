import {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask,
    hasEnemyCapability
} from '../contract/enemy_capability_contract.js';
import {
    FORMATION_COORDINATE_SYSTEM,
    isConnectedFormationOccupancyMask
} from '../contract/enemy_formation_contract.js';
import {
    ENEMY_SPAWN_POLICY
} from '../contract/enemy_profile_contract.js';
import {
    ENEMY_FORMATION_DEFINITION_BY_ID
} from 'data/object/enemy/enemy_formation_catalog_data.js';
import {
    BASIC_HEXA_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_hexa_enemy_data.js';

export const AUTHORED_WAVE_FIXED_TICKS_PER_SECOND = 60;

export const AUTHORED_WAVE_TIMELINE_COMMAND_TYPE = Object.freeze({
    SPAWN_FOR_DURATION: 'SPAWN_FOR_DURATION',
    WAIT: 'WAIT',
    SPAWN_GROUP: 'SPAWN_GROUP',
    SPAWN_FORMATION: 'SPAWN_FORMATION'
});

/** Authored/runtime coordinate vocabulary는 exact frozen identity를 공유합니다. */
export const AUTHORED_FORMATION_COORDINATE_SYSTEM = FORMATION_COORDINATE_SYSTEM;

export const AUTHORED_FORMATION_SPAWN_MODE = Object.freeze({
    ALL_AT_ONCE: 'ALL_AT_ONCE',
    SEQUENTIAL_ROWS: 'SEQUENTIAL_ROWS'
});

export const AUTHORED_WAVE_COMPILE_ERROR_CODE = Object.freeze({
    FORMATION_CAPABILITY_REQUIRED: 'formation-capability-required',
    INVALID_PERSISTENT_FORMATION: 'invalid-persistent-formation',
    TRANSFORM_PRIVATE_SPAWN_FORBIDDEN: 'transform-private-spawn-forbidden',
    UNSUPPORTED_COORDINATE_SYSTEM: 'unsupported-coordinate-system',
    TOTAL_SPAWN_CAPACITY_EXCEEDED: 'total-spawn-capacity-exceeded',
    FIXED_TICK_SPAWN_CAPACITY_EXCEEDED: 'fixed-tick-spawn-capacity-exceeded',
    SPAWN_POSITION_NOT_WALKABLE: 'spawn-position-not-walkable'
});

/** Compiler-owned bounds. These do not change GPU body or command-owner capacity. */
export const AUTHORED_WAVE_COMPILE_LIMIT = Object.freeze({
    MAXIMUM_TOTAL_SPAWN_COUNT: 65536,
    MAXIMUM_SPAWN_COUNT_PER_FIXED_TICK: 1024
});

const VALID_TIMELINE_COMMAND_TYPES = new Set(
    Object.values(AUTHORED_WAVE_TIMELINE_COMMAND_TYPE)
);
const VALID_FORMATION_COORDINATE_SYSTEMS = new Set(
    Object.values(AUTHORED_FORMATION_COORDINATE_SYSTEM)
);
const VALID_FORMATION_SPAWN_MODES = new Set(
    Object.values(AUTHORED_FORMATION_SPAWN_MODE)
);
const IMPLEMENTED_FORMATION_COORDINATE_SYSTEMS = new Set([
    AUTHORED_FORMATION_COORDINATE_SYSTEM.LINEAR_GRID,
    AUTHORED_FORMATION_COORDINATE_SYSTEM.HEX_AXIAL,
    AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE
]);
const WAIT_ENTRY_KEYS = new Set([
    'timelineEntryId',
    'type',
    'durationSeconds'
]);
const DURATION_ENTRY_KEYS = new Set([
    'timelineEntryId',
    'type',
    'durationSeconds',
    'spawnGroups'
]);
const GROUP_ENTRY_KEYS = new Set([
    'timelineEntryId',
    'type',
    'spawnGroup'
]);
const FORMATION_ENTRY_KEYS = new Set([
    'timelineEntryId',
    'type',
    'formation'
]);
const BASE_GROUP_KEYS = new Set([
    'groupId',
    'enemyDefinitionId',
    'enemyDefinitionIds',
    'routeBinding',
    'policyId',
    'count',
    'laneOffsetsTiles'
]);
const DURATION_GROUP_KEYS = new Set([
    ...BASE_GROUP_KEYS,
    'intervalTicks'
]);
const FIXED_ROUTE_BINDING_KEYS = new Set(['gateId', 'pathId']);
const ROUTE_SET_BINDING_KEYS = new Set(['routeSetId']);
const FORMATION_KEYS = new Set([
    'groupId',
    'memberCount',
    'rows',
    'columns',
    'coordinateSystem',
    'spawnMode',
    'rowDelayTicks',
    'keepFormation',
    'layout',
    'symbolMap',
    'routeBinding',
    'policyId',
    'rowSpacingTiles',
    'columnSpacingTiles',
    'anchorOffsetTiles'
]);
const VECTOR_KEYS = new Set(['x', 'y']);

function requirePlainObject(value, label) {
    const prototype = value && typeof value === 'object'
        ? Object.getPrototypeOf(value)
        : null;
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!value || typeof value !== 'object' || !isPlainObject) {
        throw new TypeError(`${label}은 plain object여야 합니다.`);
    }
    return value;
}

function assertKnownKeys(source, knownKeys, label) {
    for (const key of Object.keys(source)) {
        if (!knownKeys.has(key)) {
            throw new RangeError(`${label}에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function encodeIdentity(value, label) {
    const identity = requireNonEmptyString(value, label);
    try {
        return Object.freeze({
            value: identity,
            encoded: encodeURIComponent(identity)
        });
    } catch {
        throw new TypeError(`${label}은 URI-safe하게 encode할 수 있어야 합니다.`);
    }
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${label}은 유한 숫자여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = requireFinite(value, label);
    if (!(number > 0)) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function requireDurationTicks(value, label) {
    const seconds = requirePositiveFinite(value, label);
    const ticks = seconds * AUTHORED_WAVE_FIXED_TICKS_PER_SECOND;
    if (!Number.isSafeInteger(ticks) || ticks <= 0) {
        throw new RangeError(
            `${label}은 60Hz fixed tick으로 반올림 없이 변환되어야 합니다.`
        );
    }
    return ticks;
}

function checkedTickSum(left, right, label) {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw new RangeError(`${label}이 안전한 fixed tick 범위를 벗어났습니다.`);
    }
    return result;
}

function createCompileError(code, message, details = {}) {
    const error = new RangeError(message);
    Object.defineProperties(error, {
        code: {
            value: code,
            enumerable: true
        },
        ...Object.fromEntries(Object.entries(details).map(([key, value]) => [
            key,
            { value, enumerable: true }
        ]))
    });
    return error;
}

function snapshotVector(source, label, fallback = null) {
    if ((source === undefined || source === null) && fallback !== null) {
        return fallback;
    }
    const vector = requirePlainObject(source, label);
    assertKnownKeys(vector, VECTOR_KEYS, label);
    return Object.freeze({
        x: requireFinite(vector.x, `${label}.x`),
        y: requireFinite(vector.y, `${label}.y`)
    });
}

function snapshotLaneOffsets(source, label) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new TypeError(`${label}은 하나 이상의 lane offset 배열이어야 합니다.`);
    }
    return Object.freeze(source.map((value, index) => (
        requireFinite(value, `${label}[${index}]`)
    )));
}

function snapshotRoute(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} route가 필요합니다.`);
    }
    const gateId = requireNonEmptyString(source.gateId, `${label}.gateId`);
    const pathId = requireNonEmptyString(source.pathId, `${label}.pathId`);
    if (!Array.isArray(source.waypoints) || source.waypoints.length < 2) {
        throw new TypeError(`${label}.waypoints에는 두 개 이상의 waypoint가 필요합니다.`);
    }
    const waypoints = Object.freeze(source.waypoints.map((point, index) => Object.freeze({
        x: requireFinite(point?.x, `${label}.waypoints[${index}].x`),
        y: requireFinite(point?.y, `${label}.waypoints[${index}].y`)
    })));
    const first = waypoints[0];
    const second = waypoints[1];
    const directionX = second.x - first.x;
    const directionY = second.y - first.y;
    const directionLength = Math.hypot(directionX, directionY);
    if (!Number.isFinite(directionLength) || !(directionLength > 0)) {
        throw new RangeError(`${label}의 첫 route segment는 길이가 있어야 합니다.`);
    }
    const forward = Object.freeze({
        x: directionX / directionLength,
        y: directionY / directionLength
    });
    return Object.freeze({
        gateId,
        pathId,
        waypoints,
        forward,
        normal: Object.freeze({ x: -forward.y, y: forward.x })
    });
}

function createRouteSources(tileMap) {
    if (!tileMap
        || typeof tileMap.getSpawnRoutes !== 'function'
        || typeof tileMap.worldToTile !== 'function'
        || typeof tileMap.isWalkableTile !== 'function') {
        throw new TypeError(
            'authored wave compile에는 route와 worldToTile/isWalkableTile source가 필요합니다.'
        );
    }
    const routes = tileMap.getSpawnRoutes();
    if (!Array.isArray(routes) || routes.length === 0) {
        throw new TypeError('authored wave compile에는 하나 이상의 spawn route가 필요합니다.');
    }
    const routeByGateId = new Map();
    const routeByPathId = new Map();
    for (let index = 0; index < routes.length; index++) {
        const route = snapshotRoute(routes[index], `routes[${index}]`);
        if (routeByGateId.has(route.gateId)
            || routeByPathId.has(route.pathId)) {
            throw new RangeError(
                `중복 Gate/path route입니다: ${route.gateId}/${route.pathId}`
            );
        }
        routeByGateId.set(route.gateId, route);
        routeByPathId.set(route.pathId, route);
    }
    const routeGraph = typeof tileMap.getRouteGraph === 'function'
        ? tileMap.getRouteGraph()
        : null;
    const routeSetById = new Map();
    if (routeGraph !== null) {
        if (!routeGraph || !Array.isArray(routeGraph.routeSets)) {
            throw new TypeError('authored wave routeGraph 계약이 유효하지 않습니다.');
        }
        for (const routeSet of routeGraph.routeSets) {
            if (routeSetById.has(routeSet.id)) {
                throw new RangeError(`중복 routeSet ID입니다: ${routeSet.id}`);
            }
            const candidateRoutes = routeSet.candidates.map((candidate) => {
                const route = routeByPathId.get(candidate.pathId);
                if (!route) {
                    throw new RangeError(
                        `routeSet candidate path가 현재 map에 없습니다: ${candidate.pathId}`
                    );
                }
                return route;
            });
            routeSetById.set(routeSet.id, Object.freeze({
                routeSet,
                candidateRoutes: Object.freeze(candidateRoutes)
            }));
        }
    }
    return Object.freeze({
        routeByGateId,
        routeByPathId,
        routeGraph,
        routeSetById
    });
}

function resolveRouteBinding(source, routeSources, label) {
    const binding = requirePlainObject(source, label);
    const ownKeys = Object.keys(binding);
    if (ownKeys.length === 1 && ownKeys[0] === 'routeSetId') {
        assertKnownKeys(binding, ROUTE_SET_BINDING_KEYS, label);
        const routeSetId = requireNonEmptyString(
            binding.routeSetId,
            `${label}.routeSetId`
        );
        const resolved = routeSources.routeSetById.get(routeSetId);
        if (!resolved) {
            throw new RangeError(
                `${label}가 현재 map에 없는 routeSet을 가리킵니다: ${routeSetId}`
            );
        }
        return Object.freeze({
            route: null,
            routeSetId,
            candidateRoutes: resolved.candidateRoutes
        });
    }
    assertKnownKeys(binding, FIXED_ROUTE_BINDING_KEYS, label);
    const gateId = requireNonEmptyString(binding.gateId, `${label}.gateId`);
    const pathId = requireNonEmptyString(binding.pathId, `${label}.pathId`);
    const route = routeSources.routeByGateId.get(gateId);
    if (!route) {
        throw new RangeError(`${label}가 현재 map에 없는 Gate를 가리킵니다: ${gateId}`);
    }
    if (route.pathId !== pathId) {
        throw new RangeError(
            `${label}의 gateId/pathId가 같은 route를 가리키지 않습니다: ${gateId}/${pathId}`
        );
    }
    return Object.freeze({
        route,
        routeSetId: null,
        candidateRoutes: Object.freeze([route])
    });
}

function assertBindingWalkablePosition(tileMap, binding, offsetForRoute, label) {
    for (const route of binding.candidateRoutes) {
        assertWalkablePosition(
            tileMap,
            route,
            offsetForRoute(route),
            `${label}/${route.pathId}`
        );
    }
}

function assertWalkablePosition(tileMap, route, offset, label) {
    const x = route.waypoints[0].x + offset.x;
    const y = route.waypoints[0].y + offset.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new RangeError(`${label} spawn position이 유한 범위를 벗어났습니다.`);
    }
    const tile = tileMap.worldToTile(x, y, {});
    if (!tile?.inside || !tileMap.isWalkableTile(tile.row, tile.column)) {
        throw createCompileError(
            AUTHORED_WAVE_COMPILE_ERROR_CODE.SPAWN_POSITION_NOT_WALKABLE,
            `${label} spawn position은 보행 가능한 map tile이어야 합니다.`,
            { x, y }
        );
    }
    return Object.freeze({ x, y });
}

function assertNaturalAuthoredSpawnDefinition(definition, label) {
    if (!definition || typeof definition !== 'object') {
        throw new TypeError(`${label} enemy definition이 필요합니다.`);
    }
    if (definition.spawnPolicy !== ENEMY_SPAWN_POLICY.NATURAL) {
        throw createCompileError(
            AUTHORED_WAVE_COMPILE_ERROR_CODE.TRANSFORM_PRIVATE_SPAWN_FORBIDDEN,
            `${label}는 natural spawn definition이어야 합니다.`,
            { definitionId: definition.id ?? null }
        );
    }
    return definition;
}

function resolveDefinitionCycle(group, resolveEnemyDefinition, label) {
    const fallbackId = requireNonEmptyString(
        group.enemyDefinitionId,
        `${label}.enemyDefinitionId`
    );
    const fallbackDefinition = assertNaturalAuthoredSpawnDefinition(
        resolveEnemyDefinition(fallbackId, `${label}.enemyDefinitionId`),
        `${label}.enemyDefinitionId`
    );
    const source = group.enemyDefinitionIds;
    if (source === undefined) {
        return Object.freeze([fallbackDefinition]);
    }
    const ids = source;
    if (!Array.isArray(ids) || ids.length === 0) {
        throw new TypeError(`${label}.enemyDefinitionIds는 하나 이상의 ID 배열이어야 합니다.`);
    }
    return Object.freeze(ids.map((value, index) => {
        const definitionId = requireNonEmptyString(
            value,
            `${label}.enemyDefinitionIds[${index}]`
        );
        return assertNaturalAuthoredSpawnDefinition(
            resolveEnemyDefinition(
                definitionId,
                `${label}.enemyDefinitionIds[${index}]`
            ),
            `${label}.enemyDefinitionIds[${index}]`
        );
    }));
}

function normalizeSpawnGroup(
    source,
    routeSources,
    resolveEnemyDefinition,
    label,
    durationOwned
) {
    const group = requirePlainObject(source, label);
    assertKnownKeys(group, durationOwned ? DURATION_GROUP_KEYS : BASE_GROUP_KEYS, label);
    const groupIdentity = encodeIdentity(group.groupId, `${label}.groupId`);
    const count = requirePositiveSafeInteger(group.count, `${label}.count`);
    const intervalTicks = durationOwned
        ? requirePositiveSafeInteger(group.intervalTicks, `${label}.intervalTicks`)
        : null;
    return Object.freeze({
        groupId: groupIdentity.value,
        encodedGroupId: groupIdentity.encoded,
        definitionCycle: resolveDefinitionCycle(
            group,
            resolveEnemyDefinition,
            label
        ),
        routeBinding: resolveRouteBinding(
            group.routeBinding,
            routeSources,
            `${label}.routeBinding`
        ),
        policyId: requireNonEmptyString(group.policyId, `${label}.policyId`),
        count,
        intervalTicks,
        laneOffsetsTiles: snapshotLaneOffsets(
            group.laneOffsetsTiles,
            `${label}.laneOffsetsTiles`
        )
    });
}

function normalizeFormation(
    source,
    routeSources,
    resolveEnemyDefinition,
    label
) {
    const formation = requirePlainObject(source, label);
    assertKnownKeys(formation, FORMATION_KEYS, label);
    const groupIdentity = encodeIdentity(formation.groupId, `${label}.groupId`);
    const memberCount = requirePositiveSafeInteger(
        formation.memberCount,
        `${label}.memberCount`
    );
    const coordinateSystem = requireNonEmptyString(
        formation.coordinateSystem,
        `${label}.coordinateSystem`
    );
    if (!VALID_FORMATION_COORDINATE_SYSTEMS.has(coordinateSystem)) {
        throw new RangeError(`${label}.coordinateSystem은 알려진 vocabulary여야 합니다.`);
    }
    const spawnMode = requireNonEmptyString(
        formation.spawnMode,
        `${label}.spawnMode`
    );
    if (!VALID_FORMATION_SPAWN_MODES.has(spawnMode)) {
        throw new RangeError(`${label}.spawnMode는 알려진 spawn mode여야 합니다.`);
    }
    const rowDelayTicks = requireNonNegativeSafeInteger(
        formation.rowDelayTicks,
        `${label}.rowDelayTicks`
    );
    if (spawnMode === AUTHORED_FORMATION_SPAWN_MODE.ALL_AT_ONCE
        && rowDelayTicks !== 0) {
        throw new RangeError(`${label}.ALL_AT_ONCE rowDelayTicks는 0이어야 합니다.`);
    }
    if (spawnMode === AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS
        && rowDelayTicks === 0) {
        throw new RangeError(`${label}.SEQUENTIAL_ROWS rowDelayTicks는 양수여야 합니다.`);
    }
    const keepFormation = requireBoolean(
        formation.keepFormation,
        `${label}.keepFormation`
    );
    if (!Array.isArray(formation.layout) || formation.layout.length === 0) {
        throw new TypeError(`${label}.layout은 하나 이상의 row 배열이어야 합니다.`);
    }
    const layout = Object.freeze(formation.layout.map((row, rowIndex) => {
        if (typeof row !== 'string' || row.length === 0) {
            throw new TypeError(`${label}.layout[${rowIndex}]는 비어 있지 않은 문자열이어야 합니다.`);
        }
        return row;
    }));
    const derivedRows = layout.length;
    const derivedColumns = layout[0].length;
    for (let rowIndex = 1; rowIndex < derivedRows; rowIndex++) {
        if (layout[rowIndex].length !== derivedColumns) {
            throw new RangeError(`${label}.layout은 rectangular이어야 합니다.`);
        }
    }
    const hasRows = Object.prototype.hasOwnProperty.call(formation, 'rows');
    const hasColumns = Object.prototype.hasOwnProperty.call(formation, 'columns');
    if (hasRows !== hasColumns) {
        throw new RangeError(
            `${label}.rows와 ${label}.columns는 둘 다 제공하거나 둘 다 생략해야 합니다.`
        );
    }
    const rows = hasRows
        ? requirePositiveSafeInteger(formation.rows, `${label}.rows`)
        : derivedRows;
    const columns = hasColumns
        ? requirePositiveSafeInteger(formation.columns, `${label}.columns`)
        : derivedColumns;
    if (rows !== derivedRows || columns !== derivedColumns) {
        throw new RangeError(
            `${label}.rows/columns가 raw rectangular layout extent와 다릅니다: `
                + `${rows}x${columns}/${derivedRows}x${derivedColumns}`
        );
    }
    const symbolMapSource = requirePlainObject(formation.symbolMap, `${label}.symbolMap`);
    const symbolDefinitions = Object.create(null);
    for (const [symbol, definitionId] of Object.entries(symbolMapSource)) {
        if (symbol.length !== 1 || symbol === '.') {
            throw new RangeError(`${label}.symbolMap key는 dot이 아닌 한 글자여야 합니다.`);
        }
        symbolDefinitions[symbol] = assertNaturalAuthoredSpawnDefinition(
            resolveEnemyDefinition(
                requireNonEmptyString(definitionId, `${label}.symbolMap.${symbol}`),
                `${label}.symbolMap.${symbol}`
            ),
            `${label}.symbolMap.${symbol}`
        );
    }
    if (Object.keys(symbolDefinitions).length === 0) {
        throw new TypeError(`${label}.symbolMap에는 하나 이상의 symbol이 필요합니다.`);
    }
    const usedSymbols = new Set();
    let layoutMemberCount = 0;
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const row = layout[rowIndex];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
            const symbol = row[columnIndex];
            if (symbol === '.') {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(symbolDefinitions, symbol)) {
                throw new RangeError(
                    `${label}.layout[${rowIndex}][${columnIndex}] symbol이 symbolMap에 없습니다: ${symbol}`
                );
            }
            usedSymbols.add(symbol);
            layoutMemberCount++;
        }
    }
    if (layoutMemberCount === 0) {
        throw new RangeError(`${label}.layout에는 하나 이상의 member가 필요합니다.`);
    }
    if (layoutMemberCount !== memberCount) {
        throw new RangeError(
            `${label}.memberCount가 layout의 non-dot member count와 다릅니다: `
                + `${memberCount}/${layoutMemberCount}`
        );
    }
    for (const symbol of Object.keys(symbolDefinitions)) {
        if (!usedSymbols.has(symbol)) {
            throw new RangeError(`${label}.symbolMap에 사용되지 않은 symbol이 있습니다: ${symbol}`);
        }
    }
    let persistentFormationDefinition = null;
    let occupiedSlotMask = 0;
    let memberIndex = 0;
    const memberIndexByGridIndex = new Array(rows * columns).fill(-1);
    const memberSlotIndexByGridIndex = new Array(rows * columns).fill(-1);
    if (keepFormation) {
        if (coordinateSystem !== AUTHORED_FORMATION_COORDINATE_SYSTEM.HEX_AXIAL) {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION,
                `${label}.keepFormation layout은 HEX_AXIAL이어야 합니다.`
            );
        }
        if ((rows & 1) === 0 || (columns & 1) === 0) {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION,
                `${label}.keepFormation HEX layout rows/columns는 odd extent여야 합니다.`
            );
        }
        const centerRow = (rows - 1) / 2;
        const centerColumn = (columns - 1) / 2;
        if (layout[centerRow][centerColumn] !== '.') {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION,
                `${label}.keepFormation HEX layout center (0,0)는 비어 있어야 합니다.`
            );
        }
        for (const [symbol, definition] of Object.entries(symbolDefinitions)) {
            const capabilityMask = createEnemyCapabilityMask(
                definition.capabilityIds,
                `${label}.symbolMap.${symbol}.capabilityIds`
            );
            const hasFormation = hasEnemyCapability(
                capabilityMask,
                ENEMY_CAPABILITY_ID.FORMATION,
                `${label}.symbolMap.${symbol}.capabilityMask`
            );
            const formationDefinition = definition.formationDefinitionId
                ? ENEMY_FORMATION_DEFINITION_BY_ID[definition.formationDefinitionId]
                : null;
            if (!hasFormation
                || definition.id !== BASIC_HEXA_ENEMY_DEFINITION_ID
                || !formationDefinition) {
                throw createCompileError(
                    AUTHORED_WAVE_COMPILE_ERROR_CODE.FORMATION_CAPABILITY_REQUIRED,
                    `${label}.keepFormation member는 natural H Formation definition이어야 합니다.`,
                    { definitionId: definition.id ?? null }
                );
            }
            if (persistentFormationDefinition !== null
                && persistentFormationDefinition.id !== formationDefinition.id) {
                throw createCompileError(
                    AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION,
                    `${label}.keepFormation member는 같은 formationDefinitionId를 사용해야 합니다.`
                );
            }
            persistentFormationDefinition = formationDefinition;
        }
        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            const r = rowIndex - centerRow;
            for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
                if (layout[rowIndex][columnIndex] === '.') {
                    continue;
                }
                const q = columnIndex - centerColumn;
                const slotIndex = persistentFormationDefinition.slotCoordinates.findIndex(
                    (coordinate) => coordinate.q === q && coordinate.r === r
                );
                if (slotIndex < 0) {
                    throw createCompileError(
                        AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION,
                        `${label}.keepFormation member가 six-ring slot 밖에 있습니다.`,
                        { rowIndex, columnIndex, q, r }
                    );
                }
                const gridIndex = (rowIndex * columns) + columnIndex;
                memberIndexByGridIndex[gridIndex] = memberIndex;
                memberSlotIndexByGridIndex[gridIndex] = slotIndex;
                occupiedSlotMask |= 1 << slotIndex;
                memberIndex++;
            }
        }
        if (memberIndex !== memberCount
            || !isConnectedFormationOccupancyMask(
                persistentFormationDefinition.neighborMasks,
                occupiedSlotMask,
                persistentFormationDefinition.slotCount
            )) {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.INVALID_PERSISTENT_FORMATION,
                `${label}.keepFormation occupied six-ring subset은 connected여야 합니다.`
            );
        }
    }
    return Object.freeze({
        groupId: groupIdentity.value,
        encodedGroupId: groupIdentity.encoded,
        memberCount,
        rows,
        columns,
        coordinateSystem,
        spawnMode,
        rowDelayTicks,
        keepFormation,
        layout,
        symbolDefinitions: Object.freeze(symbolDefinitions),
        persistentFormationDefinition,
        occupiedSlotMask,
        memberIndexByGridIndex: Object.freeze(memberIndexByGridIndex),
        memberSlotIndexByGridIndex: Object.freeze(memberSlotIndexByGridIndex),
        routeBinding: resolveRouteBinding(
            formation.routeBinding,
            routeSources,
            `${label}.routeBinding`
        ),
        policyId: requireNonEmptyString(formation.policyId, `${label}.policyId`),
        rowSpacingTiles: requirePositiveFinite(
            formation.rowSpacingTiles,
            `${label}.rowSpacingTiles`
        ),
        columnSpacingTiles: requirePositiveFinite(
            formation.columnSpacingTiles,
            `${label}.columnSpacingTiles`
        ),
        anchorOffsetTiles: snapshotVector(
            formation.anchorOffsetTiles,
            `${label}.anchorOffsetTiles`,
            Object.freeze({ x: 0, y: 0 })
        )
    });
}

function resolveLaneWorldOffset(route, laneOffsetTiles) {
    return Object.freeze({
        x: route.normal.x * laneOffsetTiles,
        y: route.normal.y * laneOffsetTiles
    });
}

function resolveFormationWorldOffset(
    formation,
    rowIndex,
    columnIndex,
    route = formation.routeBinding.route
) {
    if (formation.coordinateSystem
        === AUTHORED_FORMATION_COORDINATE_SYSTEM.HEX_AXIAL) {
        const q = columnIndex - ((formation.columns - 1) * 0.5);
        const r = rowIndex - ((formation.rows - 1) * 0.5);
        return Object.freeze({
            x: formation.anchorOffsetTiles.x
                + ((q + (r * 0.5)) * formation.columnSpacingTiles),
            y: formation.anchorOffsetTiles.y
                + (r * formation.rowSpacingTiles)
        });
    }
    const localX = formation.anchorOffsetTiles.x
        + ((columnIndex - ((formation.columns - 1) * 0.5))
            * formation.columnSpacingTiles);
    const localY = formation.anchorOffsetTiles.y
        + (rowIndex * formation.rowSpacingTiles);
    if (formation.coordinateSystem
        === AUTHORED_FORMATION_COORDINATE_SYSTEM.LINEAR_GRID) {
        return Object.freeze({ x: localX, y: localY });
    }
    if (formation.coordinateSystem
        === AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE) {
        if (!route) {
            throw new TypeError('PATH_RELATIVE formation에는 resolved route가 필요합니다.');
        }
        return Object.freeze({
            x: (route.normal.x * localX)
                + (route.forward.x * localY),
            y: (route.normal.y * localX)
                + (route.forward.y * localY)
        });
    }
    throw createCompileError(
        AUTHORED_WAVE_COMPILE_ERROR_CODE.UNSUPPORTED_COORDINATE_SYSTEM,
        `Turn 2에서 지원하지 않는 formation coordinate system입니다: ${formation.coordinateSystem}`,
        { coordinateSystem: formation.coordinateSystem }
    );
}

/**
 * Authored timeline을 immutable spawn schedule로 compile합니다. Intent numeric stats는
 * queue boundary에서 한 번만 resolve하므로 이 결과에는 아직 intent를 만들지 않습니다.
 */
export function compileAuthoredWaveTimeline(options = {}) {
    const waveIdentity = encodeIdentity(options.waveId, 'waveId');
    const fixedTickOffset = requireNonNegativeSafeInteger(
        options.fixedTickOffset ?? 0,
        'fixedTickOffset'
    );
    if (!Array.isArray(options.timeline) || options.timeline.length === 0) {
        throw new TypeError('WaveDefinition.timeline에는 하나 이상의 entry가 필요합니다.');
    }
    if (typeof options.resolveEnemyDefinition !== 'function') {
        throw new TypeError('authored wave compile에는 resolveEnemyDefinition()이 필요합니다.');
    }
    const tileMap = options.tileMap;
    const routeSources = createRouteSources(tileMap);
    const schedule = [];
    const spawnCountByFixedTick = new Map();
    const timelineEntryIds = new Set();
    const groupIds = new Set();
    let localCursorTick = 1;
    let spawnSequence = 0;

    const appendSpawn = ({
        localFixedTick,
        timelineIdentity,
        groupId,
        encodedGroupId,
        definition,
        routeBinding,
        policyId,
        laneOffsetTiles,
        initialWorldOffsetTiles,
        initialWorldOffsetByPathId = null,
        formationProvenance = null,
        preserveGroupRoute = false,
        commandTail
    }) => {
        const targetFixedTick = checkedTickSum(
            fixedTickOffset,
            localFixedTick,
            'wave targetFixedTick'
        );
        if (schedule.length >= AUTHORED_WAVE_COMPILE_LIMIT.MAXIMUM_TOTAL_SPAWN_COUNT) {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.TOTAL_SPAWN_CAPACITY_EXCEEDED,
                'authored wave total spawn compile capacity를 초과했습니다.'
            );
        }
        const tickCount = (spawnCountByFixedTick.get(targetFixedTick) ?? 0) + 1;
        if (tickCount
            > AUTHORED_WAVE_COMPILE_LIMIT.MAXIMUM_SPAWN_COUNT_PER_FIXED_TICK) {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.FIXED_TICK_SPAWN_CAPACITY_EXCEEDED,
                `authored wave fixed tick spawn compile capacity를 초과했습니다: ${targetFixedTick}`,
                { targetFixedTick }
            );
        }
        spawnCountByFixedTick.set(targetFixedTick, tickCount);
        const commandId = [
            'authored-wave-spawn',
            waveIdentity.encoded,
            timelineIdentity.encoded,
            encodedGroupId,
            commandTail
        ].join(':');
        schedule.push(Object.freeze({
            commandId,
            targetFixedTick,
            definition,
            route: routeBinding.route,
            routeSetId: routeBinding.routeSetId,
            routeCandidatePathIds: Object.freeze(
                routeBinding.candidateRoutes.map((route) => route.pathId)
            ),
            spawnSequence,
            laneOffsetTiles,
            initialWorldOffsetTiles,
            initialWorldOffsetByPathId,
            waveId: waveIdentity.value,
            policyId,
            timelineEntryId: timelineIdentity.value,
            groupId,
            preserveGroupRoute: preserveGroupRoute === true,
            formationProvenance
        }));
        spawnSequence++;
    };

    const registerGroupId = (groupId, label) => {
        if (groupIds.has(groupId)) {
            throw new RangeError(`${label}가 wave 안에서 중복되었습니다: ${groupId}`);
        }
        groupIds.add(groupId);
    };

    for (let entryIndex = 0; entryIndex < options.timeline.length; entryIndex++) {
        const label = `timeline[${entryIndex}]`;
        const entry = requirePlainObject(options.timeline[entryIndex], label);
        const timelineIdentity = encodeIdentity(
            entry.timelineEntryId,
            `${label}.timelineEntryId`
        );
        if (timelineEntryIds.has(timelineIdentity.value)) {
            throw new RangeError(
                `${label}.timelineEntryId가 중복되었습니다: ${timelineIdentity.value}`
            );
        }
        timelineEntryIds.add(timelineIdentity.value);
        const type = requireNonEmptyString(entry.type, `${label}.type`);
        if (!VALID_TIMELINE_COMMAND_TYPES.has(type)) {
            throw new RangeError(`${label}.type은 알려진 timeline command여야 합니다.`);
        }

        if (type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT) {
            assertKnownKeys(entry, WAIT_ENTRY_KEYS, label);
            localCursorTick = checkedTickSum(
                localCursorTick,
                requireDurationTicks(entry.durationSeconds, `${label}.durationSeconds`),
                'WAIT cursor tick'
            );
            continue;
        }

        if (type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FOR_DURATION) {
            assertKnownKeys(entry, DURATION_ENTRY_KEYS, label);
            const durationTicks = requireDurationTicks(
                entry.durationSeconds,
                `${label}.durationSeconds`
            );
            if (!Array.isArray(entry.spawnGroups) || entry.spawnGroups.length === 0) {
                throw new TypeError(`${label}.spawnGroups에는 하나 이상의 group이 필요합니다.`);
            }
            for (let groupIndex = 0; groupIndex < entry.spawnGroups.length; groupIndex++) {
                const groupLabel = `${label}.spawnGroups[${groupIndex}]`;
                const group = normalizeSpawnGroup(
                    entry.spawnGroups[groupIndex],
                    routeSources,
                    options.resolveEnemyDefinition,
                    groupLabel,
                    true
                );
                registerGroupId(group.groupId, `${groupLabel}.groupId`);
                const lastSpawnOffset = (group.count - 1) * group.intervalTicks;
                if (!Number.isSafeInteger(lastSpawnOffset)
                    || lastSpawnOffset >= durationTicks) {
                    throw new RangeError(`${groupLabel} schedule이 duration을 벗어납니다.`);
                }
                for (let spawnIndex = 0; spawnIndex < group.count; spawnIndex++) {
                    const laneOffsetTiles = group.laneOffsetsTiles[
                        spawnIndex % group.laneOffsetsTiles.length
                    ];
                    assertBindingWalkablePosition(
                        tileMap,
                        group.routeBinding,
                        (route) => resolveLaneWorldOffset(route, laneOffsetTiles),
                        `${groupLabel}[${spawnIndex}]`
                    );
                    appendSpawn({
                        localFixedTick: checkedTickSum(
                            localCursorTick,
                            spawnIndex * group.intervalTicks,
                            `${groupLabel} local fixed tick`
                        ),
                        timelineIdentity,
                        groupId: group.groupId,
                        encodedGroupId: group.encodedGroupId,
                        definition: group.definitionCycle[
                            spawnIndex % group.definitionCycle.length
                        ],
                        routeBinding: group.routeBinding,
                        policyId: group.policyId,
                        laneOffsetTiles,
                        initialWorldOffsetTiles: null,
                        formationProvenance: null,
                        commandTail: `spawn-${spawnIndex}`
                    });
                }
            }
            localCursorTick = checkedTickSum(
                localCursorTick,
                durationTicks,
                'SPAWN_FOR_DURATION cursor tick'
            );
            continue;
        }

        if (type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP) {
            assertKnownKeys(entry, GROUP_ENTRY_KEYS, label);
            const groupLabel = `${label}.spawnGroup`;
            const group = normalizeSpawnGroup(
                entry.spawnGroup,
                routeSources,
                options.resolveEnemyDefinition,
                groupLabel,
                false
            );
            registerGroupId(group.groupId, `${groupLabel}.groupId`);
            for (let spawnIndex = 0; spawnIndex < group.count; spawnIndex++) {
                const laneOffsetTiles = group.laneOffsetsTiles[
                    spawnIndex % group.laneOffsetsTiles.length
                ];
                assertBindingWalkablePosition(
                    tileMap,
                    group.routeBinding,
                    (route) => resolveLaneWorldOffset(route, laneOffsetTiles),
                    `${groupLabel}[${spawnIndex}]`
                );
                appendSpawn({
                    localFixedTick: localCursorTick,
                    timelineIdentity,
                    groupId: group.groupId,
                    encodedGroupId: group.encodedGroupId,
                    definition: group.definitionCycle[
                        spawnIndex % group.definitionCycle.length
                    ],
                    routeBinding: group.routeBinding,
                    policyId: group.policyId,
                    laneOffsetTiles,
                    initialWorldOffsetTiles: null,
                    formationProvenance: null,
                    commandTail: `spawn-${spawnIndex}`
                });
            }
            localCursorTick = checkedTickSum(
                localCursorTick,
                1,
                'SPAWN_GROUP cursor tick'
            );
            continue;
        }

        assertKnownKeys(entry, FORMATION_ENTRY_KEYS, label);
        const formation = normalizeFormation(
            entry.formation,
            routeSources,
            options.resolveEnemyDefinition,
            `${label}.formation`
        );
        registerGroupId(formation.groupId, `${label}.formation.groupId`);
        if (!IMPLEMENTED_FORMATION_COORDINATE_SYSTEMS.has(
            formation.coordinateSystem
        )) {
            throw createCompileError(
                AUTHORED_WAVE_COMPILE_ERROR_CODE.UNSUPPORTED_COORDINATE_SYSTEM,
                `Turn 2에서 지원하지 않는 formation coordinate system입니다: ${formation.coordinateSystem}`,
                { coordinateSystem: formation.coordinateSystem }
            );
        }
        for (let rowIndex = 0; rowIndex < formation.rows; rowIndex++) {
            const rowTickOffset = formation.spawnMode
                === AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS
                ? rowIndex * formation.rowDelayTicks
                : 0;
            for (let columnIndex = 0; columnIndex < formation.columns; columnIndex++) {
                const symbol = formation.layout[rowIndex][columnIndex];
                if (symbol === '.') {
                    continue;
                }
                const initialWorldOffsets = formation.routeBinding.candidateRoutes.map(
                    (route) => Object.freeze({
                        pathId: route.pathId,
                        offset: resolveFormationWorldOffset(
                            formation,
                            rowIndex,
                            columnIndex,
                            route
                        )
                    })
                );
                for (const entryOffset of initialWorldOffsets) {
                    const route = routeSources.routeByPathId.get(entryOffset.pathId);
                    assertWalkablePosition(
                        tileMap,
                        route,
                        entryOffset.offset,
                        `${label}.formation.layout[${rowIndex}][${columnIndex}]/${entryOffset.pathId}`
                    );
                }
                const initialWorldOffsetTiles = formation.routeBinding.routeSetId === null
                    ? initialWorldOffsets[0].offset
                    : null;
                const initialWorldOffsetByPathId
                    = formation.routeBinding.routeSetId === null
                    ? null
                    : Object.freeze(Object.fromEntries(
                        initialWorldOffsets.map(({ pathId, offset }) => [pathId, offset])
                    ));
                appendSpawn({
                    localFixedTick: checkedTickSum(
                        localCursorTick,
                        rowTickOffset,
                        `${label}.formation local fixed tick`
                    ),
                    timelineIdentity,
                    groupId: formation.groupId,
                    encodedGroupId: formation.encodedGroupId,
                    definition: formation.symbolDefinitions[symbol],
                    routeBinding: formation.routeBinding,
                    policyId: formation.policyId,
                    laneOffsetTiles: 0,
                    initialWorldOffsetTiles,
                    initialWorldOffsetByPathId,
                    formationProvenance: formation.keepFormation
                        ? Object.freeze({
                            formationGroupId: formation.groupId,
                            formationAuthoredCoordinateSystemId:
                                formation.coordinateSystem,
                            formationAuthoredMemberCount: formation.memberCount,
                            formationRows: formation.rows,
                            formationColumns: formation.columns,
                            formationMemberIndex:
                                formation.memberIndexByGridIndex[
                                    (rowIndex * formation.columns) + columnIndex
                                ],
                            // Authored six-ring slot provenance입니다. Runtime composite
                            // occupancy authority는 별도 occupiedSlotMask/state가 소유합니다.
                            formationMemberSlotIndex:
                                formation.memberSlotIndexByGridIndex[
                                    (rowIndex * formation.columns) + columnIndex
                                ],
                            formationRowIndex: rowIndex,
                            formationColumnIndex: columnIndex,
                            formationAuthoredOccupiedSlotMask:
                                formation.occupiedSlotMask
                        })
                        : null,
                    preserveGroupRoute: true,
                    commandTail: `member-${rowIndex}-${columnIndex}`
                });
            }
        }
        const lastRowOffset = formation.spawnMode
            === AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS
            ? (formation.rows - 1) * formation.rowDelayTicks
            : 0;
        localCursorTick = checkedTickSum(
            localCursorTick,
            lastRowOffset + 1,
            'SPAWN_FORMATION cursor tick'
        );
    }

    schedule.sort((left, right) => (
        left.targetFixedTick - right.targetFixedTick
        || left.spawnSequence - right.spawnSequence
    ));
    return Object.freeze(schedule);
}
