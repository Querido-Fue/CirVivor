import { CORRIDOR_EIGHT_MAP_DATA } from './corridor_eight_map_data.js';

const TILE_TYPES = Object.freeze({
    VOID: '.',
    FLOOR: 'F'
});

const MAPS = Object.freeze([
    Object.freeze({
        id: CORRIDOR_EIGHT_MAP_DATA.id,
        nameKey: CORRIDOR_EIGHT_MAP_DATA.nameKey,
        descriptionKey: CORRIDOR_EIGHT_MAP_DATA.descriptionKey,
        rows: CORRIDOR_EIGHT_MAP_DATA.macroRows,
        columns: CORRIDOR_EIGHT_MAP_DATA.macroColumns,
        tiles: CORRIDOR_EIGHT_MAP_DATA.previewTiles,
        playerSpawn: Object.freeze({
            row: CORRIDOR_EIGHT_MAP_DATA.towerSpawnMacroCell[0],
            column: CORRIDOR_EIGHT_MAP_DATA.towerSpawnMacroCell[1]
        })
    })
]);

/**
 * 그리드 기반 게임 맵 카탈로그와 기본 맵 ID입니다.
 */
export const GAME_MAP_DATA = Object.freeze({
    DEFAULT_MAP_ID: CORRIDOR_EIGHT_MAP_DATA.id,
    TILE_TYPES,
    MAPS
});
