import {
    MAP_VISUAL_THEME_ID
} from './purple_crystal_map_visual_theme_data.js';

export const PERFORMANCE_SERPENTINE_MAP_ID = 'performance_serpentine_02';
export const PERFORMANCE_SERPENTINE_GATE_ID = 'performance-west-gate';
export const PERFORMANCE_SERPENTINE_PATH_ID = 'performance-serpentine-core';
export const PERFORMANCE_SERPENTINE_MACRO_ROWS = 7;
export const PERFORMANCE_SERPENTINE_MACRO_COLUMNS = 12;
export const PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES = 10;
export const PERFORMANCE_SERPENTINE_FLOW_TRANSITION_RADIUS_TILES = 4.5;

const IDENTITY_ENEMY_MODIFIERS = Object.freeze({
    global: Object.freeze({
        multipliers: Object.freeze({
            maxHealth: 1,
            moveSpeedTilesPerSecond: 1,
            weight: 1,
            towerContactDamage: 1,
            coreImpactDamage: 1,
            bountyBudget: 1
        }),
        absolute: Object.freeze({})
    }),
    byEnemyDefinitionId: Object.freeze({})
});

/**
 * 폭 10짜리 수평 통로 4개를 한 칸짜리 수직 굴곡으로 번갈아 연결합니다.
 * 같은 행 사이에는 빈 macro row가 있으므로 인접한 평행 통로로 건너뛰지 않고,
 * 오직 ㄹ자 순서로 51개 waypoint를 통과합니다.
 */
function createSerpentineMacroCells() {
    const cells = [];
    const horizontalRunCount = (PERFORMANCE_SERPENTINE_MACRO_ROWS + 1) / 2;
    for (let runIndex = 0; runIndex < horizontalRunCount; runIndex++) {
        const row = runIndex * 2;
        const leftToRight = (runIndex % 2) === 0;
        for (let offset = 0;
            offset < PERFORMANCE_SERPENTINE_MACRO_COLUMNS;
            offset++) {
            const column = leftToRight
                ? offset
                : PERFORMANCE_SERPENTINE_MACRO_COLUMNS - 1 - offset;
            cells.push(Object.freeze([row, column]));
        }
        if (runIndex + 1 < horizontalRunCount) {
            cells.push(Object.freeze([
                row + 1,
                leftToRight ? PERFORMANCE_SERPENTINE_MACRO_COLUMNS - 1 : 0
            ]));
        }
    }
    return Object.freeze(cells);
}

const PERFORMANCE_SERPENTINE_MACRO_CELLS = createSerpentineMacroCells();
const FLOOR_CELL_KEYS = new Set(PERFORMANCE_SERPENTINE_MACRO_CELLS.map(
    ([row, column]) => `${row}:${column}`
));

function createMacroRows(floorCharacter, voidCharacter) {
    return Object.freeze(Array.from(
        { length: PERFORMANCE_SERPENTINE_MACRO_ROWS },
        (_, row) => Array.from(
            { length: PERFORMANCE_SERPENTINE_MACRO_COLUMNS },
            (_, column) => FLOOR_CELL_KEYS.has(`${row}:${column}`)
                ? floorCharacter
                : voidCharacter
        ).join('')
    ));
}

const DIRECTION_BLUEPRINT = createMacroRows('.', '#');
const PREVIEW_TILES = createMacroRows('F', '.');
const PERFORMANCE_SERPENTINE_ROUTE = Object.freeze({
    gateId: PERFORMANCE_SERPENTINE_GATE_ID,
    pathId: PERFORMANCE_SERPENTINE_PATH_ID,
    macroCells: PERFORMANCE_SERPENTINE_MACRO_CELLS
});
const PERFORMANCE_SERPENTINE_ROUTES = Object.freeze([
    PERFORMANCE_SERPENTINE_ROUTE
]);

/** 실제 10,000-body 성능 검증을 위한 두 번째 production map입니다. */
export const PERFORMANCE_SERPENTINE_MAP_DATA = Object.freeze({
    id: PERFORMANCE_SERPENTINE_MAP_ID,
    visualThemeId: MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL,
    nameKey: 'game_map_performance_serpentine_name',
    descriptionKey: 'game_map_performance_serpentine_description',
    macroRows: PERFORMANCE_SERPENTINE_MACRO_ROWS,
    macroColumns: PERFORMANCE_SERPENTINE_MACRO_COLUMNS,
    pathWidthTiles: PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES,
    flowTransitionRadiusTiles:
        PERFORMANCE_SERPENTINE_FLOW_TRANSITION_RADIUS_TILES,
    directionBlueprint: DIRECTION_BLUEPRINT,
    previewTiles: PREVIEW_TILES,
    enemyModifiers: IDENTITY_ENEMY_MODIFIERS,
    coreMacroCell: Object.freeze([6, 0]),
    towerSpawnMacroCell: Object.freeze([6, 1]),
    enemySpawnRoutes: PERFORMANCE_SERPENTINE_ROUTES
});
