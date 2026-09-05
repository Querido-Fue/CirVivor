import {
    ENEMY_ROUTE_GRAPH_NODE_KIND,
    ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY,
    ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_VERSION,
    normalizeEnemyRouteGraph
} from 'ingame/contract/enemy_route_closure_contract.js';
import {
    MAP_VISUAL_THEME_ID
} from './purple_crystal_map_visual_theme_data.js';

export const R2_ENEMY_SHOWCASE_MAP_ID = 'r2_enemy_showcase_01';
export const R2_ENEMY_SHOWCASE_ROUTE_SET_ID = 'r2-showcase-west-dual-core';
export const R2_ENEMY_SHOWCASE_UPPER_PATH_ID = 'r2-showcase-upper-core';
export const R2_ENEMY_SHOWCASE_LOWER_PATH_ID = 'r2-showcase-lower-core';
export const R2_ENEMY_SHOWCASE_UPPER_CLOSURE_ID = 'r2-showcase-upper-cork';
export const R2_ENEMY_SHOWCASE_LOWER_CLOSURE_ID = 'r2-showcase-lower-cork';
export const R2_ENEMY_SHOWCASE_TOWER_MACRO_CELL = Object.freeze([3, 10]);

/** Radius-6 O slot centers와 대각 위치가 모두 내부에 머무는 3×3 floor authority입니다. */
export const R2_ENEMY_SHOWCASE_ORBIT_CLEARANCE_MACRO_CELLS = Object.freeze([
    Object.freeze([2, 9]),
    Object.freeze([2, 10]),
    Object.freeze([2, 11]),
    Object.freeze([3, 9]),
    R2_ENEMY_SHOWCASE_TOWER_MACRO_CELL,
    Object.freeze([3, 11]),
    Object.freeze([4, 9]),
    Object.freeze([4, 10]),
    Object.freeze([4, 11])
]);

const R2_SHOWCASE_DIRECTION_BLUEPRINT = Object.freeze([
    '##############',
    '##############',
    '#...........##',
    '..###........#',
    '#.....##.....#',
    '############.#',
    '##############'
]);

const R2_SHOWCASE_PREVIEW_TILES = Object.freeze([
    '..............',
    '..............',
    '.FFFFFFFFFFF..',
    'FF...FFFFFFFF.',
    '.FFFFF..FFFFF.',
    '............F.',
    '..............'
]);

const R2_SHOWCASE_ENEMY_MODIFIERS = Object.freeze({
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

const COMMON_POST_MERGE_ROUTE = Object.freeze([
    Object.freeze([3, 5]),
    Object.freeze([3, 6]),
    Object.freeze([3, 7]),
    Object.freeze([3, 8]),
    Object.freeze([2, 8]),
    Object.freeze([2, 9]),
    Object.freeze([2, 10]),
    Object.freeze([2, 11]),
    Object.freeze([3, 11]),
    Object.freeze([4, 11]),
    Object.freeze([4, 10]),
    Object.freeze([4, 9]),
    Object.freeze([4, 8]),
    Object.freeze([3, 8]),
    Object.freeze([3, 9]),
    R2_ENEMY_SHOWCASE_TOWER_MACRO_CELL,
    Object.freeze([3, 11]),
    Object.freeze([3, 12]),
    Object.freeze([4, 12]),
    Object.freeze([5, 12])
]);

const UPPER_ROUTE_MACRO_CELLS = Object.freeze([
    Object.freeze([3, 0]),
    Object.freeze([3, 1]),
    Object.freeze([2, 1]),
    Object.freeze([2, 2]),
    Object.freeze([2, 3]),
    Object.freeze([2, 4]),
    Object.freeze([2, 5]),
    ...COMMON_POST_MERGE_ROUTE
]);

const LOWER_ROUTE_MACRO_CELLS = Object.freeze([
    Object.freeze([3, 0]),
    Object.freeze([3, 1]),
    Object.freeze([4, 1]),
    Object.freeze([4, 2]),
    Object.freeze([4, 3]),
    Object.freeze([4, 4]),
    Object.freeze([4, 5]),
    ...COMMON_POST_MERGE_ROUTE
]);

const R2_SHOWCASE_SPAWN_ROUTES = Object.freeze([
    Object.freeze({
        gateId: 'r2-showcase-upper-gate',
        pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
        macroCells: UPPER_ROUTE_MACRO_CELLS
    }),
    Object.freeze({
        gateId: 'r2-showcase-lower-gate',
        pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
        macroCells: LOWER_ROUTE_MACRO_CELLS
    })
]);

const R2_SHOWCASE_ROUTE_GRAPH = normalizeEnemyRouteGraph({
    version: ENEMY_ROUTE_GRAPH_VERSION,
    routeSets: [{
        id: R2_ENEMY_SHOWCASE_ROUTE_SET_ID,
        candidates: [
            { pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID, priority: 0 },
            { pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID, priority: 1 }
        ],
        selectionPolicyId:
            ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY
                .LOWEST_OPEN_PRIORITY_THEN_PATH_ID,
        noOpenRoutePolicyId:
            ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY.HOLD_AT_ENTRY
    }],
    nodes: [
        {
            id: 'r2-showcase-entry',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.ENTRANCE,
            memberships: [
                {
                    pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                    waypointIndex: 0,
                    progressOrdinal: 0
                },
                {
                    pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                    waypointIndex: 0,
                    progressOrdinal: 0
                }
            ]
        },
        {
            id: 'r2-showcase-switch',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.SWITCH,
            memberships: [
                {
                    pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                    waypointIndex: 1,
                    progressOrdinal: 1
                },
                {
                    pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                    waypointIndex: 1,
                    progressOrdinal: 1
                }
            ]
        },
        {
            id: 'r2-showcase-upper-clearance',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE,
            memberships: [{
                pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                waypointIndex: 3,
                progressOrdinal: 3
            }]
        },
        {
            id: 'r2-showcase-upper-closure',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE,
            memberships: [{
                pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                waypointIndex: 4,
                progressOrdinal: 4
            }]
        },
        {
            id: 'r2-showcase-lower-clearance',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE,
            memberships: [{
                pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                waypointIndex: 3,
                progressOrdinal: 3
            }]
        },
        {
            id: 'r2-showcase-lower-closure',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE,
            memberships: [{
                pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                waypointIndex: 4,
                progressOrdinal: 4
            }]
        },
        {
            id: 'r2-showcase-merge',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.MERGE,
            memberships: [
                {
                    pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                    waypointIndex: 7,
                    progressOrdinal: 7
                },
                {
                    pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                    waypointIndex: 7,
                    progressOrdinal: 7
                }
            ]
        },
        {
            id: 'r2-showcase-core',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CORE,
            memberships: [
                {
                    pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                    waypointIndex: 26,
                    progressOrdinal: 26
                },
                {
                    pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                    waypointIndex: 26,
                    progressOrdinal: 26
                }
            ]
        }
    ],
    switches: [{
        id: 'r2-showcase-forward-switch',
        nodeId: 'r2-showcase-switch',
        selectionPolicyId:
            ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY
                .OPEN_FORWARD_LOWEST_PRIORITY_PATH_ID,
        transitions: [
            {
                fromPathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                toPathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                targetWaypointIndex: 2,
                priority: 1
            },
            {
                fromPathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
                toPathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
                targetWaypointIndex: 2,
                priority: 0
            }
        ]
    }],
    closures: [
        {
            id: R2_ENEMY_SHOWCASE_UPPER_CLOSURE_ID,
            pathId: R2_ENEMY_SHOWCASE_UPPER_PATH_ID,
            entranceNodeId: 'r2-showcase-upper-closure',
            clearanceNodeId: 'r2-showcase-upper-clearance',
            upstreamSwitchNodeId: 'r2-showcase-switch',
            downstreamMergeNodeId: 'r2-showcase-merge',
            priority: 0
        },
        {
            id: R2_ENEMY_SHOWCASE_LOWER_CLOSURE_ID,
            pathId: R2_ENEMY_SHOWCASE_LOWER_PATH_ID,
            entranceNodeId: 'r2-showcase-lower-closure',
            clearanceNodeId: 'r2-showcase-lower-clearance',
            upstreamSwitchNodeId: 'r2-showcase-switch',
            downstreamMergeNodeId: 'r2-showcase-merge',
            priority: 1
        }
    ]
}, {
    routes: R2_SHOWCASE_SPAWN_ROUTES
}, 'R2_ENEMY_SHOWCASE_MAP_DATA.routeGraph');

/** Turn 9 staged showcase 전용이며 default production registry에는 자동 등록하지 않습니다. */
export const R2_ENEMY_SHOWCASE_MAP_DATA = Object.freeze({
    id: R2_ENEMY_SHOWCASE_MAP_ID,
    visualThemeId: MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL,
    nameKey: 'game_map_r2_enemy_showcase_name',
    descriptionKey: 'game_map_r2_enemy_showcase_description',
    macroRows: 7,
    macroColumns: 14,
    pathWidthTiles: 6,
    directionBlueprint: R2_SHOWCASE_DIRECTION_BLUEPRINT,
    previewTiles: R2_SHOWCASE_PREVIEW_TILES,
    enemyModifiers: R2_SHOWCASE_ENEMY_MODIFIERS,
    coreMacroCell: Object.freeze([5, 12]),
    towerSpawnMacroCell: R2_ENEMY_SHOWCASE_TOWER_MACRO_CELL,
    enemySpawnRoutes: R2_SHOWCASE_SPAWN_ROUTES,
    routeGraph: R2_SHOWCASE_ROUTE_GRAPH
});
