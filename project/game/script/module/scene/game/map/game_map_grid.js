import { GAME_MAP_DATA } from 'data/scene/game/game_map_data.js';

const TILE_TYPES = GAME_MAP_DATA.TILE_TYPES;
const WORLD_LAYOUT = Object.freeze({
    MAX_WIDTH_RATIO: 0.78,
    MAX_OBJECT_HEIGHT_RATIO: 0.82,
    WALL_THICKNESS_CELL_RATIO: 0.12,
    WALL_MIN_THICKNESS_PX: 6,
    TILE_GAP_CELL_RATIO: 0.035
});
const BASE_GLOBAL_OBJECT = globalThis;
const BASE_ARRAY_CONSTRUCTOR = Array;
const BASE_NUMBER_CONSTRUCTOR = Number;
const BASE_ARRAY_IS_ARRAY = Array.isArray;
const BASE_NUMBER_IS_INTEGER = Number.isInteger;
const BASE_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;

/**
 * 값이 양의 유한수이면 그대로 반환하고, 그렇지 않으면 대체값을 반환합니다.
 * @param {number} value - 검사할 값입니다.
 * @param {number} fallback - 유효하지 않을 때 사용할 값입니다.
 * @returns {number} 안전한 양의 유한수입니다.
 */
function resolvePositiveNumber(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 맵 정의가 기하 생성에 사용할 수 있는 직사각형 그리드인지 확인합니다.
 * @param {object|null|undefined} mapDefinition - 검사할 맵 정의입니다.
 * @returns {boolean} 유효한 맵 정의이면 true입니다.
 */
function isValidGameMapDefinition(mapDefinition) {
    if (!mapDefinition
        || typeof mapDefinition.id !== 'string'
        || mapDefinition.id.length === 0
        || !Number.isInteger(mapDefinition.rows)
        || mapDefinition.rows <= 0
        || !Number.isInteger(mapDefinition.columns)
        || mapDefinition.columns <= 0
        || !Array.isArray(mapDefinition.tiles)
        || mapDefinition.tiles.length !== mapDefinition.rows) {
        return false;
    }

    for (let row = 0; row < mapDefinition.rows; row++) {
        const tileRow = mapDefinition.tiles[row];
        if (typeof tileRow !== 'string' || tileRow.length !== mapDefinition.columns) {
            return false;
        }
        for (let column = 0; column < mapDefinition.columns; column++) {
            const tileType = tileRow[column];
            if (tileType !== TILE_TYPES.FLOOR && tileType !== TILE_TYPES.VOID) {
                return false;
            }
        }
    }

    return true;
}

/**
 * 등록된 맵 정의 목록을 안전하게 반환합니다.
 * @returns {object[]} 등록된 맵 목록입니다.
 */
function getRegisteredGameMaps() {
    return Array.isArray(GAME_MAP_DATA?.MAPS) ? GAME_MAP_DATA.MAPS : [];
}

/**
 * 맵 정의 또는 맵 ID를 등록된 맵 정의로 변환합니다.
 * @param {object|string|null|undefined} mapOrId - 맵 정의 또는 ID입니다.
 * @returns {object|null} 사용할 수 있는 맵 정의입니다.
 */
function resolveMapArgument(mapOrId) {
    if (mapOrId !== null && typeof mapOrId === 'object') {
        return isValidGameMapDefinition(mapOrId) ? mapOrId : null;
    }
    return resolveGameMapDefinition(mapOrId);
}

/**
 * 검증이 끝난 맵 정의에서 지정 셀이 바닥인지 확인합니다.
 * @param {object} mapDefinition - 유효한 맵 정의입니다.
 * @param {number} row - 0부터 시작하는 행 번호입니다.
 * @param {number} column - 0부터 시작하는 열 번호입니다.
 * @returns {boolean} 바닥 셀이면 true입니다.
 */
function isFloorCellInDefinition(mapDefinition, row, column) {
    return Number.isInteger(row)
        && Number.isInteger(column)
        && row >= 0
        && row < mapDefinition.rows
        && column >= 0
        && column < mapDefinition.columns
        && mapDefinition.tiles[row][column] === TILE_TYPES.FLOOR;
}

/**
 * 등록 맵의 불변 identity인지 확인합니다.
 * @param {object|null|undefined} mapDefinition - 확인할 맵 정의입니다.
 * @returns {boolean} 현재 registry에 등록된 동일 객체이면 true입니다.
 */
function isRegisteredGameMapIdentity(mapDefinition) {
    const maps = GAME_MAP_DATA?.MAPS;
    if (!BASE_ARRAY_IS_ARRAY(maps)) {
        return false;
    }
    for (let i = 0; i < maps.length; i++) {
        if (maps[i] === mapDefinition) {
            return true;
        }
    }
    return false;
}

/**
 * 맵 검증에 쓰는 전역 intrinsic이 모듈 평가 시점의 data descriptor를 유지하는지 확인합니다.
 * @returns {boolean} 등록 맵 전용 fast path를 안전하게 사용할 수 있으면 true입니다.
 */
function hasBaselineMapValidationIntrinsics() {
    const globalArrayDescriptor = BASE_GET_OWN_PROPERTY_DESCRIPTOR(
        BASE_GLOBAL_OBJECT,
        'Array'
    );
    const globalNumberDescriptor = BASE_GET_OWN_PROPERTY_DESCRIPTOR(
        BASE_GLOBAL_OBJECT,
        'Number'
    );
    const isArrayDescriptor = BASE_GET_OWN_PROPERTY_DESCRIPTOR(
        BASE_ARRAY_CONSTRUCTOR,
        'isArray'
    );
    const isIntegerDescriptor = BASE_GET_OWN_PROPERTY_DESCRIPTOR(
        BASE_NUMBER_CONSTRUCTOR,
        'isInteger'
    );
    return globalArrayDescriptor?.value === BASE_ARRAY_CONSTRUCTOR
        && globalNumberDescriptor?.value === BASE_NUMBER_CONSTRUCTOR
        && isArrayDescriptor?.value === BASE_ARRAY_IS_ARRAY
        && isIntegerDescriptor?.value === BASE_NUMBER_IS_INTEGER;
}

/**
 * 존재하지 않는 맵 ID를 기본 맵 ID로 정규화합니다.
 * @param {string|null|undefined} mapId - 정규화할 맵 ID입니다.
 * @returns {string|null} 등록된 맵 ID이며, 유효한 맵이 없으면 null입니다.
 */
export function normalizeGameMapId(mapId) {
    const maps = getRegisteredGameMaps();
    const requestedId = typeof mapId === 'string' ? mapId.trim() : '';

    if (requestedId.length > 0) {
        for (let i = 0; i < maps.length; i++) {
            const mapDefinition = maps[i];
            if (isValidGameMapDefinition(mapDefinition) && mapDefinition.id === requestedId) {
                return mapDefinition.id;
            }
        }
    }

    const defaultId = typeof GAME_MAP_DATA?.DEFAULT_MAP_ID === 'string'
        ? GAME_MAP_DATA.DEFAULT_MAP_ID
        : '';
    for (let i = 0; i < maps.length; i++) {
        const mapDefinition = maps[i];
        if (isValidGameMapDefinition(mapDefinition) && mapDefinition.id === defaultId) {
            return mapDefinition.id;
        }
    }

    for (let i = 0; i < maps.length; i++) {
        if (isValidGameMapDefinition(maps[i])) {
            return maps[i].id;
        }
    }

    return null;
}

/**
 * 맵 ID에 해당하는 정의를 반환하며, 알 수 없는 ID는 기본 맵으로 대체합니다.
 * @param {string|null|undefined} mapId - 찾을 맵 ID입니다.
 * @returns {object|null} 맵 정의이며, 유효한 맵이 없으면 null입니다.
 */
export function resolveGameMapDefinition(mapId) {
    const normalizedId = normalizeGameMapId(mapId);
    if (normalizedId === null) {
        return null;
    }

    const maps = getRegisteredGameMaps();
    for (let i = 0; i < maps.length; i++) {
        const mapDefinition = maps[i];
        if (isValidGameMapDefinition(mapDefinition) && mapDefinition.id === normalizedId) {
            return mapDefinition;
        }
    }

    return null;
}

/**
 * 지정 셀이 맵 범위 안의 보행 가능한 바닥인지 확인합니다.
 * @param {object|string|null|undefined} mapOrId - 맵 정의 또는 맵 ID입니다.
 * @param {number} row - 0부터 시작하는 행 번호입니다.
 * @param {number} column - 0부터 시작하는 열 번호입니다.
 * @returns {boolean} 바닥 셀이면 true입니다.
 */
export function isGameMapFloorCell(mapOrId, row, column) {
    const mapDefinition = resolveMapArgument(mapOrId);
    return mapDefinition ? isFloorCellInDefinition(mapDefinition, row, column) : false;
}

/**
 * `resolveGameMapDefinition()`이 반환한 등록 맵의 바닥 셀을 반복 조회합니다.
 * 등록 identity와 숫자/배열 intrinsic이 그대로인 일반 경로에서는 맵 전체 재검증을 생략합니다.
 * custom 정의나 전역 intrinsic 변경이 감지되면 `isGameMapFloorCell()`의 전체 계약으로 되돌아갑니다.
 * @param {object|null|undefined} mapDefinition - 등록 resolver가 반환한 맵 정의입니다.
 * @param {number} row - 0부터 시작하는 행 번호입니다.
 * @param {number} column - 0부터 시작하는 열 번호입니다.
 * @returns {boolean} 바닥 셀이면 true입니다.
 */
export function isResolvedGameMapFloorCell(mapDefinition, row, column) {
    if (!isRegisteredGameMapIdentity(mapDefinition)
        || !hasBaselineMapValidationIntrinsics()) {
        return isGameMapFloorCell(mapDefinition, row, column);
    }
    return BASE_NUMBER_IS_INTEGER(row)
        && BASE_NUMBER_IS_INTEGER(column)
        && row >= 0
        && row < mapDefinition.rows
        && column >= 0
        && column < mapDefinition.columns
        && mapDefinition.tiles[row][column] === TILE_TYPES.FLOOR;
}

/**
 * 맵에서 안전하게 사용할 플레이어 스폰 셀을 찾습니다.
 * @param {object} mapDefinition - 맵 정의입니다.
 * @returns {{row:number, column:number}|null} 바닥 스폰 셀이며, 바닥이 없으면 null입니다.
 */
function resolvePlayerSpawnCell(mapDefinition) {
    const spawn = mapDefinition.playerSpawn;
    if (spawn
        && isFloorCellInDefinition(mapDefinition, spawn.row, spawn.column)) {
        return {
            row: spawn.row,
            column: spawn.column
        };
    }

    for (let row = 0; row < mapDefinition.rows; row++) {
        for (let column = 0; column < mapDefinition.columns; column++) {
            if (isFloorCellInDefinition(mapDefinition, row, column)) {
                return { row, column };
            }
        }
    }

    return null;
}

/**
 * 바닥과 비바닥 사이의 수평·수직 경계 표시 배열을 생성합니다.
 * @param {object} mapDefinition - 맵 정의입니다.
 * @returns {{horizontal: Uint8Array[], vertical: Uint8Array[]}} 경계 표시 배열입니다.
 */
function buildBoundaryEdgeFlags(mapDefinition) {
    const horizontal = Array.from(
        { length: mapDefinition.rows + 1 },
        () => new Uint8Array(mapDefinition.columns)
    );
    const vertical = Array.from(
        { length: mapDefinition.columns + 1 },
        () => new Uint8Array(mapDefinition.rows)
    );

    for (let row = 0; row < mapDefinition.rows; row++) {
        for (let column = 0; column < mapDefinition.columns; column++) {
            if (!isFloorCellInDefinition(mapDefinition, row, column)) {
                continue;
            }

            if (!isFloorCellInDefinition(mapDefinition, row - 1, column)) {
                horizontal[row][column] = 1;
            }
            if (!isFloorCellInDefinition(mapDefinition, row + 1, column)) {
                horizontal[row + 1][column] = 1;
            }
            if (!isFloorCellInDefinition(mapDefinition, row, column - 1)) {
                vertical[column][row] = 1;
            }
            if (!isFloorCellInDefinition(mapDefinition, row, column + 1)) {
                vertical[column + 1][row] = 1;
            }
        }
    }

    return { horizontal, vertical };
}

/**
 * 수평 경계 표시를 연속 구간별 중심 기준 벽 사각형으로 병합합니다.
 * @param {Uint8Array[]} horizontalEdges - 수평 경계 표시 배열입니다.
 * @param {object} metrics - 맵 배치 수치입니다.
 * @param {object[]} walls - 결과 벽 배열입니다.
 * @returns {void}
 */
function appendMergedHorizontalWalls(horizontalEdges, metrics, walls) {
    const { originX, originY, cellSize, wallThickness } = metrics;

    for (let edgeRow = 0; edgeRow < horizontalEdges.length; edgeRow++) {
        const edgeFlags = horizontalEdges[edgeRow];
        let column = 0;
        while (column < edgeFlags.length) {
            if (edgeFlags[column] === 0) {
                column++;
                continue;
            }

            const startColumn = column;
            while (column < edgeFlags.length && edgeFlags[column] !== 0) {
                column++;
            }
            const runLength = column - startColumn;
            walls.push({
                x: originX + ((startColumn + (runLength * 0.5)) * cellSize),
                y: originY + (edgeRow * cellSize),
                w: runLength * cellSize,
                h: wallThickness,
                origin: 'center'
            });
        }
    }
}

/**
 * 수직 경계 표시를 연속 구간별 중심 기준 벽 사각형으로 병합합니다.
 * @param {Uint8Array[]} verticalEdges - 수직 경계 표시 배열입니다.
 * @param {object} metrics - 맵 배치 수치입니다.
 * @param {object[]} walls - 결과 벽 배열입니다.
 * @returns {void}
 */
function appendMergedVerticalWalls(verticalEdges, metrics, walls) {
    const { originX, originY, cellSize, wallThickness } = metrics;

    for (let edgeColumn = 0; edgeColumn < verticalEdges.length; edgeColumn++) {
        const edgeFlags = verticalEdges[edgeColumn];
        let row = 0;
        while (row < edgeFlags.length) {
            if (edgeFlags[row] === 0) {
                row++;
                continue;
            }

            const startRow = row;
            while (row < edgeFlags.length && edgeFlags[row] !== 0) {
                row++;
            }
            const runLength = row - startRow;
            walls.push({
                x: originX + (edgeColumn * cellSize),
                y: originY + ((startRow + (runLength * 0.5)) * cellSize),
                w: wallThickness,
                h: runLength * cellSize,
                origin: 'center'
            });
        }
    }
}

/**
 * 유효한 맵이 없을 때도 유한한 좌표를 제공하는 빈 기하를 생성합니다.
 * @param {number} ww - 월드 너비입니다.
 * @param {number} objectWH - 오브젝트 월드 높이입니다.
 * @returns {object} 빈 맵 기하입니다.
 */
function buildEmptyGameMapGeometry(ww, objectWH) {
    return {
        mapId: null,
        rows: 0,
        columns: 0,
        originX: ww * 0.5,
        originY: objectWH * 0.5,
        cellSize: 0,
        width: 0,
        height: 0,
        tileGapRatio: resolvePositiveNumber(WORLD_LAYOUT.TILE_GAP_CELL_RATIO, 0.035),
        floorLocalCenters: [],
        playerSpawn: {
            x: ww * 0.5,
            y: objectWH * 0.5
        },
        boundaryWalls: []
    };
}

/**
 * 선택한 맵을 현재 오브젝트 월드에 맞춘 정사각 셀 기하로 변환합니다.
 * @param {object|string|null|undefined} mapOrId - 맵 정의 또는 맵 ID입니다.
 * @param {{ww?:number, objectWH?:number}|null} viewport - 오브젝트 월드 크기입니다.
 * @returns {object} 바닥 중심, 플레이어 스폰, 병합 경계 벽을 포함한 기하입니다.
 */
export function buildGameMapGeometry(mapOrId, viewport = null) {
    const ww = resolvePositiveNumber(viewport?.ww, 1);
    const objectWH = resolvePositiveNumber(viewport?.objectWH, 1);
    const mapDefinition = resolveMapArgument(mapOrId);
    if (!mapDefinition) {
        return buildEmptyGameMapGeometry(ww, objectWH);
    }

    const maxWidthRatio = resolvePositiveNumber(WORLD_LAYOUT.MAX_WIDTH_RATIO, 0.78);
    const maxObjectHeightRatio = resolvePositiveNumber(
        WORLD_LAYOUT.MAX_OBJECT_HEIGHT_RATIO,
        0.82
    );
    const cellSize = Math.min(
        (ww * maxWidthRatio) / mapDefinition.columns,
        (objectWH * maxObjectHeightRatio) / mapDefinition.rows
    );
    const width = cellSize * mapDefinition.columns;
    const height = cellSize * mapDefinition.rows;
    const originX = (ww - width) * 0.5;
    const originY = (objectWH - height) * 0.5;
    const tileGapRatio = resolvePositiveNumber(WORLD_LAYOUT.TILE_GAP_CELL_RATIO, 0.035);
    const wallThickness = Math.max(
        resolvePositiveNumber(WORLD_LAYOUT.WALL_MIN_THICKNESS_PX, 6),
        cellSize * resolvePositiveNumber(WORLD_LAYOUT.WALL_THICKNESS_CELL_RATIO, 0.12)
    );
    const floorLocalCenters = [];

    for (let row = 0; row < mapDefinition.rows; row++) {
        for (let column = 0; column < mapDefinition.columns; column++) {
            if (!isFloorCellInDefinition(mapDefinition, row, column)) {
                continue;
            }
            floorLocalCenters.push({
                row,
                column,
                x: column + 0.5,
                y: row + 0.5
            });
        }
    }

    const spawnCell = resolvePlayerSpawnCell(mapDefinition);
    const playerSpawn = spawnCell
        ? {
            x: originX + ((spawnCell.column + 0.5) * cellSize),
            y: originY + ((spawnCell.row + 0.5) * cellSize)
        }
        : {
            x: ww * 0.5,
            y: objectWH * 0.5
        };
    const boundaryWalls = [];
    const boundaryEdges = buildBoundaryEdgeFlags(mapDefinition);
    const wallMetrics = { originX, originY, cellSize, wallThickness };
    appendMergedHorizontalWalls(boundaryEdges.horizontal, wallMetrics, boundaryWalls);
    appendMergedVerticalWalls(boundaryEdges.vertical, wallMetrics, boundaryWalls);

    return {
        mapId: mapDefinition.id,
        rows: mapDefinition.rows,
        columns: mapDefinition.columns,
        originX,
        originY,
        cellSize,
        width,
        height,
        tileGapRatio,
        floorLocalCenters,
        playerSpawn,
        boundaryWalls
    };
}
