const TILE_TYPES = Object.freeze({
    VOID: '.',
    FLOOR: 'F'
});

const D_CORRIDOR_TILES = Object.freeze([
    'FFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFF',
    '............FFF',
    '............FFF',
    '............FFF',
    '............FFF',
    '............FFF',
    'FFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFF'
]);

const MAPS = Object.freeze([
    Object.freeze({
        id: 'd_corridor_01',
        nameKey: 'game_map_d_corridor_name',
        descriptionKey: 'game_map_d_corridor_description',
        rows: 11,
        columns: 15,
        tiles: D_CORRIDOR_TILES,
        playerSpawn: Object.freeze({
            row: 5,
            column: 13
        })
    })
]);

/**
 * 그리드 기반 게임 맵 카탈로그와 기본 맵 ID입니다.
 */
export const GAME_MAP_DATA = Object.freeze({
    DEFAULT_MAP_ID: 'd_corridor_01',
    TILE_TYPES,
    MAPS
});
