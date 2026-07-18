const TILE_TYPES = Object.freeze({
    VOID: '.',
    FLOOR: 'F'
});

const WORLD_LAYOUT = Object.freeze({
    MAX_WIDTH_RATIO: 0.78,
    MAX_OBJECT_HEIGHT_RATIO: 0.82,
    WALL_THICKNESS_CELL_RATIO: 0.12,
    WALL_MIN_THICKNESS_PX: 6,
    TILE_GAP_CELL_RATIO: 0.035
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
 * 그리드 기반 게임 맵과 월드 배치에 사용하는 정적 데이터입니다.
 */
export const GAME_MAP_DATA = Object.freeze({
    DEFAULT_MAP_ID: 'd_corridor_01',
    TILE_TYPES,
    WORLD_LAYOUT,
    MAPS
});
