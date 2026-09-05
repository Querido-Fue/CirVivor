import {
    MAP_VISUAL_THEME_ID
} from './purple_crystal_map_visual_theme_data.js';

const CORRIDOR_EIGHT_DIRECTION_BLUEPRINT = Object.freeze([
    'a#kji####',
    'b#l#h####',
    'cdefgrstu',
    '##m#q###v',
    '##nop###w'
]);

const CORRIDOR_EIGHT_PREVIEW_TILES = Object.freeze([
    'F.FFF....',
    'F.F.F....',
    'FFFFFFFFF',
    '..F.F...F',
    '..FFF...F'
]);

/**
 * 첫 production map의 Enemy modifier는 의도적으로 identity입니다.
 * 값은 queue-time ResolvedEnemySpawnStats가 profile base와 곱한 뒤 해석합니다.
 */
const CORRIDOR_EIGHT_MAP_ENEMY_MODIFIERS = Object.freeze({
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
 * ASCII의 문자 순서를 실제 인접한 매크로 셀 경로로 풀어 쓴 목록입니다.
 *
 * 중앙 교차점 `(2, 2)`와 `(2, 4)`는 경로 진행 중 다시 통과합니다.
 * 따라서 적은 위치만으로 진행 방향을 추론하지 않고 route waypoint index를
 * 함께 보유해야 합니다.
 */
const WEST_FIGURE_EIGHT_ROUTE = Object.freeze([
    Object.freeze([0, 0]),
    Object.freeze([1, 0]),
    Object.freeze([2, 0]),
    Object.freeze([2, 1]),
    Object.freeze([2, 2]),
    Object.freeze([2, 3]),
    Object.freeze([2, 4]),
    Object.freeze([1, 4]),
    Object.freeze([0, 4]),
    Object.freeze([0, 3]),
    Object.freeze([0, 2]),
    Object.freeze([1, 2]),
    Object.freeze([2, 2]),
    Object.freeze([3, 2]),
    Object.freeze([4, 2]),
    Object.freeze([4, 3]),
    Object.freeze([4, 4]),
    Object.freeze([3, 4]),
    Object.freeze([2, 4]),
    Object.freeze([2, 5]),
    Object.freeze([2, 6]),
    Object.freeze([2, 7]),
    Object.freeze([2, 8]),
    Object.freeze([3, 8]),
    Object.freeze([4, 8])
]);

/**
 * 첫 인게임 맵의 선언 데이터입니다.
 *
 * `directionBlueprint`의 알파벳은 적 이동 순서를 설명하는 authoring 표식이며
 * 타일 종류 ID가 아닙니다. 실제 바닥은 각 route의 매크로 셀을
 * `PATH_WIDTH_TILES × PATH_WIDTH_TILES` 블록으로 확장해 생성합니다.
 */
export const CORRIDOR_EIGHT_MAP_DATA = Object.freeze({
    id: 'corridor_eight_01',
    visualThemeId: MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL,
    nameKey: 'game_map_corridor_eight_name',
    descriptionKey: 'game_map_corridor_eight_description',
    macroRows: 5,
    macroColumns: 9,
    pathWidthTiles: 6,
    directionBlueprint: CORRIDOR_EIGHT_DIRECTION_BLUEPRINT,
    previewTiles: CORRIDOR_EIGHT_PREVIEW_TILES,
    enemyModifiers: CORRIDOR_EIGHT_MAP_ENEMY_MODIFIERS,
    coreMacroCell: Object.freeze([4, 8]),
    towerSpawnMacroCell: Object.freeze([2, 7]),
    enemySpawnRoutes: Object.freeze([
        Object.freeze({
            gateId: 'west-gate-01',
            pathId: 'west-figure-eight-core',
            macroCells: WEST_FIGURE_EIGHT_ROUTE
        })
    ])
});

/**
 * 신규 인게임 맵 registry입니다.
 * 소비 코드는 문자열 lookup을 직접 구현하지 않고 map resolver를 사용합니다.
 */
export const INGAME_MAP_DATA = Object.freeze({
    DEFAULT_MAP_ID: CORRIDOR_EIGHT_MAP_DATA.id,
    MAPS: Object.freeze([
        CORRIDOR_EIGHT_MAP_DATA,
        PERFORMANCE_SERPENTINE_MAP_DATA
    ])
});
import {
    PERFORMANCE_SERPENTINE_MAP_DATA
} from './performance_serpentine_map_data.js';
