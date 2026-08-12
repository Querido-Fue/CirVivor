import { INGAME_MAP_DATA } from 'data/scene/game/corridor_eight_map_data.js';
import { assertTileNavigationSource } from '../contract/tile_navigation_contract.js';
import {
    normalizeEnemyModifierSet
} from '../object/enemy/resolved_enemy_spawn_stats.js';
import {
    normalizeEnemyRouteGraph
} from '../contract/enemy_route_closure_contract.js';

const MAX_TILE_CELLS = 1000000;

/**
 * 시뮬레이션과 AI가 공유하는 한 실제 타일의 월드 길이입니다.
 * 렌더 픽셀 크기는 카메라 projection이 뷰포트마다 계산합니다.
 */
export const TILE_WORLD_SIZE = 1;

/**
 * 등록된 인게임 맵 ID를 정의로 변환합니다.
 * 알 수 없는 ID는 기본 맵으로 대체합니다.
 * @param {*} mapId - 요청한 맵 ID입니다.
 * @returns {object} 등록된 맵 정의입니다.
 */
export function resolveIngameMapDefinition(mapId) {
    const requestedId = typeof mapId === 'string' ? mapId.trim() : '';
    const maps = INGAME_MAP_DATA.MAPS;
    for (let index = 0; index < maps.length; index++) {
        if (maps[index].id === requestedId) {
            return maps[index];
        }
    }
    for (let index = 0; index < maps.length; index++) {
        if (maps[index].id === INGAME_MAP_DATA.DEFAULT_MAP_ID) {
            return maps[index];
        }
    }
    throw new Error('등록된 인게임 맵이 없습니다.');
}

/**
 * `[row, column]` 매크로 셀을 검증합니다.
 * @param {*} cell - 검사할 셀 tuple입니다.
 * @param {number} rows - 매크로 행 수입니다.
 * @param {number} columns - 매크로 열 수입니다.
 * @param {string} label - 오류에 사용할 필드명입니다.
 * @returns {void}
 */
function assertMacroCell(cell, rows, columns, label) {
    if (!Array.isArray(cell)
        || cell.length !== 2
        || !Number.isInteger(cell[0])
        || !Number.isInteger(cell[1])
        || cell[0] < 0
        || cell[0] >= rows
        || cell[1] < 0
        || cell[1] >= columns) {
        throw new TypeError(`${label}은 맵 안의 [row, column]이어야 합니다.`);
    }
}

/**
 * 방향 blueprint와 route 데이터를 검증합니다.
 * @param {object} definition - 맵 선언 데이터입니다.
 * @returns {void}
 */
function assertMapDefinition(definition) {
    const rows = definition?.macroRows;
    const columns = definition?.macroColumns;
    const pathWidth = definition?.pathWidthTiles;
    if (typeof definition?.id !== 'string'
        || definition.id.length === 0
        || !Number.isInteger(rows)
        || rows <= 0
        || !Number.isInteger(columns)
        || columns <= 0
        || !Number.isInteger(pathWidth)
        || pathWidth <= 0) {
        throw new TypeError('인게임 맵의 ID·크기·pathWidthTiles가 유효해야 합니다.');
    }
    if (!Array.isArray(definition.directionBlueprint)
        || definition.directionBlueprint.length !== rows) {
        throw new TypeError('directionBlueprint 행 수가 맵 정의와 다릅니다.');
    }
    for (let row = 0; row < rows; row++) {
        if (typeof definition.directionBlueprint[row] !== 'string'
            || definition.directionBlueprint[row].length !== columns) {
            throw new TypeError(`directionBlueprint ${row}행의 열 수가 유효하지 않습니다.`);
        }
    }

    assertMacroCell(definition.coreMacroCell, rows, columns, 'coreMacroCell');
    assertMacroCell(definition.towerSpawnMacroCell, rows, columns, 'towerSpawnMacroCell');
    if (!Array.isArray(definition.enemySpawnRoutes)
        || definition.enemySpawnRoutes.length === 0) {
        throw new TypeError('인게임 맵에는 하나 이상의 enemySpawnRoutes가 필요합니다.');
    }

    const gateIds = new Set();
    const pathIds = new Set();
    for (let routeIndex = 0; routeIndex < definition.enemySpawnRoutes.length; routeIndex++) {
        const route = definition.enemySpawnRoutes[routeIndex];
        if (typeof route?.gateId !== 'string'
            || route.gateId.length === 0
            || gateIds.has(route.gateId)
            || typeof route?.pathId !== 'string'
            || route.pathId.length === 0
            || pathIds.has(route.pathId)
            || !Array.isArray(route.macroCells)
            || route.macroCells.length < 2) {
            throw new TypeError(`enemySpawnRoutes[${routeIndex}] 계약이 유효하지 않습니다.`);
        }
        gateIds.add(route.gateId);
        pathIds.add(route.pathId);

        for (let cellIndex = 0; cellIndex < route.macroCells.length; cellIndex++) {
            const cell = route.macroCells[cellIndex];
            assertMacroCell(
                cell,
                rows,
                columns,
                `enemySpawnRoutes[${routeIndex}].macroCells[${cellIndex}]`
            );
            if (definition.directionBlueprint[cell[0]][cell[1]] === '#') {
                throw new TypeError('적 route가 directionBlueprint의 비경로 셀을 통과합니다.');
            }
            if (cellIndex > 0) {
                const previous = route.macroCells[cellIndex - 1];
                const manhattanDistance = Math.abs(cell[0] - previous[0])
                    + Math.abs(cell[1] - previous[1]);
                if (manhattanDistance !== 1) {
                    throw new TypeError('적 route의 모든 매크로 셀은 직교 인접해야 합니다.');
                }
            }
        }

        const lastCell = route.macroCells[route.macroCells.length - 1];
        if (lastCell[0] !== definition.coreMacroCell[0]
            || lastCell[1] !== definition.coreMacroCell[1]) {
            throw new TypeError('모든 적 route는 같은 Core 셀에서 끝나야 합니다.');
        }
    }
}

/**
 * @class TileMap
 * @description 방향 route를 타일 월드와 Flow Field용 blocked grid로 컴파일합니다.
 */
export class TileMap {
    /**
     * @param {object} definition - 선언형 인게임 맵 데이터입니다.
     */
    constructor(definition) {
        assertMapDefinition(definition);

        this.mapId = definition.id;
        this.enemyModifiers = normalizeEnemyModifierSet(definition.enemyModifiers, {
            label: `${definition.id}.enemyModifiers`
        });
        this.pathWidthTiles = definition.pathWidthTiles;
        this.tileSize = TILE_WORLD_SIZE;
        this.rows = definition.macroRows * this.pathWidthTiles;
        this.columns = definition.macroColumns * this.pathWidthTiles;
        const size = this.rows * this.columns;
        if (!Number.isSafeInteger(size) || size > MAX_TILE_CELLS) {
            throw new RangeError(`타일 맵 크기는 ${MAX_TILE_CELLS}셀 이하여야 합니다.`);
        }

        const blocked = new Uint8Array(size);
        blocked.fill(1);
        this.navigationGrid = Object.freeze({
            cols: this.columns,
            rows: this.rows,
            size,
            cellSize: this.tileSize,
            blocked
        });
        this.worldBounds = Object.freeze({
            minX: 0,
            minY: 0,
            maxX: this.columns * this.tileSize,
            maxY: this.rows * this.tileSize,
            width: this.columns * this.tileSize,
            height: this.rows * this.tileSize
        });

        this.#markRouteFloors(definition.enemySpawnRoutes);
        this.spawnRoutes = this.#buildSpawnRoutes(definition.enemySpawnRoutes);
        this.routeGraph = definition.routeGraph === undefined
            || definition.routeGraph === null
            ? null
            : normalizeEnemyRouteGraph(
                definition.routeGraph,
                { routes: definition.enemySpawnRoutes },
                `${definition.id}.routeGraph`
            );
        this.corePosition = Object.freeze(
            this.#macroCellToWorldPosition(definition.coreMacroCell)
        );
        this.towerSpawnPosition = Object.freeze(
            this.#macroCellToWorldPosition(definition.towerSpawnMacroCell)
        );

        const coreTile = this.worldToTile(
            this.corePosition.x,
            this.corePosition.y,
            {}
        );
        const towerTile = this.worldToTile(
            this.towerSpawnPosition.x,
            this.towerSpawnPosition.y,
            {}
        );
        if (!this.isWalkableTile(coreTile.row, coreTile.column)
            || !this.isWalkableTile(towerTile.row, towerTile.column)) {
            throw new TypeError('Core와 Tower 스폰은 보행 가능한 route 위에 있어야 합니다.');
        }
        assertTileNavigationSource(this);
    }

    /** @returns {object} WASM/JS Flow Field가 공유할 고정 타일 grid입니다. */
    getNavigationGrid() {
        return this.navigationGrid;
    }

    /** @returns {object[]} gate/path/waypoint를 포함한 복수 적 진입 route입니다. */
    getSpawnRoutes() {
        return this.spawnRoutes;
    }

    /**
     * @returns {object|null} optional v1 route topology입니다.
     * Legacy map은 null이며 runtime closure를 지원하지 않습니다.
     */
    getRouteGraph() {
        return this.routeGraph;
    }

    /** @returns {{x:number,y:number,row:number,column:number}} Core 중심입니다. */
    getCorePosition() {
        return this.corePosition;
    }

    /** @returns {{x:number,y:number,row:number,column:number}} Tower 시작 중심입니다. */
    getTowerSpawnPosition() {
        return this.towerSpawnPosition;
    }

    /** @returns {object} 월드 경계입니다. */
    getWorldBounds() {
        return this.worldBounds;
    }

    /** @returns {object} map-owned immutable Enemy modifier snapshot입니다. */
    getEnemyModifiers() {
        return this.enemyModifiers;
    }

    /**
     * 지정 실제 타일이 보행 가능한지 반환합니다. 범위 밖은 막힌 셀입니다.
     * @param {number} row - 실제 타일 행입니다.
     * @param {number} column - 실제 타일 열입니다.
     * @returns {boolean} 보행 가능 여부입니다.
     */
    isWalkableTile(row, column) {
        return Number.isInteger(row)
            && Number.isInteger(column)
            && row >= 0
            && row < this.rows
            && column >= 0
            && column < this.columns
            && this.navigationGrid.blocked[(row * this.columns) + column] === 0;
    }

    /**
     * 월드 좌표를 실제 타일 좌표로 변환합니다.
     * @param {*} x - 월드 X입니다.
     * @param {*} y - 월드 Y입니다.
     * @param {object} [out={}] - 재사용 결과 객체입니다.
     * @returns {{row:number,column:number,inside:boolean}} 결과 객체입니다.
     */
    worldToTile(x, y, out = {}) {
        const numericX = Number(x);
        const numericY = Number(y);
        out.column = Number.isFinite(numericX)
            ? Math.floor(numericX / this.tileSize)
            : -1;
        out.row = Number.isFinite(numericY)
            ? Math.floor(numericY / this.tileSize)
            : -1;
        out.inside = out.row >= 0
            && out.row < this.rows
            && out.column >= 0
            && out.column < this.columns;
        return out;
    }

    /**
     * 실제 타일 중심을 월드 좌표로 변환합니다.
     * @param {number} row - 실제 타일 행입니다.
     * @param {number} column - 실제 타일 열입니다.
     * @param {object} [out={}] - 재사용 결과 객체입니다.
     * @returns {{x:number,y:number,row:number,column:number}} 결과 객체입니다.
     */
    tileToWorld(row, column, out = {}) {
        if (!Number.isInteger(row)
            || !Number.isInteger(column)
            || row < 0
            || row >= this.rows
            || column < 0
            || column >= this.columns) {
            throw new RangeError('tileToWorld 좌표가 맵 범위를 벗어났습니다.');
        }
        out.row = row;
        out.column = column;
        out.x = (column + 0.5) * this.tileSize;
        out.y = (row + 0.5) * this.tileSize;
        return out;
    }

    /**
     * route가 사용하는 매크로 블록을 실제 보행 가능 타일로 표시합니다.
     * @param {object[]} routes - 선언형 적 route입니다.
     * @returns {void}
     * @private
     */
    #markRouteFloors(routes) {
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
            const macroCells = routes[routeIndex].macroCells;
            for (let cellIndex = 0; cellIndex < macroCells.length; cellIndex++) {
                const macroRow = macroCells[cellIndex][0];
                const macroColumn = macroCells[cellIndex][1];
                const startRow = macroRow * this.pathWidthTiles;
                const startColumn = macroColumn * this.pathWidthTiles;
                for (let rowOffset = 0; rowOffset < this.pathWidthTiles; rowOffset++) {
                    const rowIndex = (startRow + rowOffset) * this.columns;
                    for (
                        let columnOffset = 0;
                        columnOffset < this.pathWidthTiles;
                        columnOffset++
                    ) {
                        this.navigationGrid.blocked[
                            rowIndex + startColumn + columnOffset
                        ] = 0;
                    }
                }
            }
        }
    }

    /**
     * 적 생성기와 PathFollower가 소비할 불변 route snapshot을 생성합니다.
     * @param {object[]} routes - 선언형 적 route입니다.
     * @returns {object[]} 컴파일된 route 목록입니다.
     * @private
     */
    #buildSpawnRoutes(routes) {
        const compiledRoutes = [];
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
            const route = routes[routeIndex];
            const waypoints = [];
            for (let cellIndex = 0; cellIndex < route.macroCells.length; cellIndex++) {
                waypoints.push(Object.freeze(
                    this.#macroCellToWorldPosition(route.macroCells[cellIndex])
                ));
            }
            Object.freeze(waypoints);
            compiledRoutes.push(Object.freeze({
                gateId: route.gateId,
                pathId: route.pathId,
                entryPoint: waypoints[0],
                coreAttackPoint: waypoints[waypoints.length - 1],
                waypoints
            }));
        }
        return Object.freeze(compiledRoutes);
    }

    /**
     * 매크로 셀의 기하학적 중앙과 Flow Field용 대표 타일을 계산합니다.
     *
     * 짝수 폭에서는 중앙이 두 실제 타일 사이 경계에 놓입니다. 월드 위치는
     * 대칭성을 유지하고, `row`/`column`은 경계의 아래·오른쪽 타일을
     * 결정적으로 선택합니다.
     * @param {[number,number]} macroCell - `[row, column]` 매크로 셀입니다.
     * @returns {{x:number,y:number,row:number,column:number}} 위치입니다.
     * @private
     */
    #macroCellToWorldPosition(macroCell) {
        const startRow = macroCell[0] * this.pathWidthTiles;
        const startColumn = macroCell[1] * this.pathWidthTiles;
        const centerOffset = this.pathWidthTiles * 0.5;
        const x = (startColumn + centerOffset) * this.tileSize;
        const y = (startRow + centerOffset) * this.tileSize;
        return {
            x,
            y,
            row: Math.floor(y / this.tileSize),
            column: Math.floor(x / this.tileSize)
        };
    }
}

/**
 * 등록된 ID로 타일 맵을 생성합니다.
 * @param {*} mapId - 요청한 맵 ID입니다.
 * @returns {TileMap} 컴파일된 타일 맵입니다.
 */
export function createTileMap(mapId) {
    return new TileMap(resolveIngameMapDefinition(mapId));
}
