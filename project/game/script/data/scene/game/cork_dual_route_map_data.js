import {
    ENEMY_ROUTE_GRAPH_NODE_KIND,
    ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY,
    ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_VERSION,
    normalizeEnemyRouteGraph
} from 'ingame/contract/enemy_route_closure_contract.js';

export const CORK_DUAL_ROUTE_MAP_ID = 'cork_dual_route_01';
export const CORK_DUAL_ROUTE_ROUTE_SET_ID = 'west-dual-core-01';
export const CORK_DUAL_ROUTE_UPPER_PATH_ID = 'west-upper-core';
export const CORK_DUAL_ROUTE_LOWER_PATH_ID = 'west-lower-core';
export const CORK_DUAL_ROUTE_UPPER_CLOSURE_ID = 'upper-cork-01';
export const CORK_DUAL_ROUTE_LOWER_CLOSURE_ID = 'lower-cork-01';

const CORK_DUAL_ROUTE_DIRECTION_BLUEPRINT = Object.freeze([
    '#########',
    '#abcde###',
    'fg###hijk',
    '#lmnop###',
    '#########'
]);

const CORK_DUAL_ROUTE_PREVIEW_TILES = Object.freeze([
    '.........',
    '.FFFFF...',
    'FF...FFFF',
    '.FFFFF...',
    '.........'
]);

const CORK_DUAL_ROUTE_MAP_ENEMY_MODIFIERS = Object.freeze({
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

const UPPER_ROUTE_MACRO_CELLS = Object.freeze([
    Object.freeze([2, 0]),
    Object.freeze([2, 1]),
    Object.freeze([1, 1]),
    Object.freeze([1, 2]),
    Object.freeze([1, 3]),
    Object.freeze([1, 4]),
    Object.freeze([1, 5]),
    Object.freeze([2, 5]),
    Object.freeze([2, 6]),
    Object.freeze([2, 7]),
    Object.freeze([2, 8])
]);

const LOWER_ROUTE_MACRO_CELLS = Object.freeze([
    Object.freeze([2, 0]),
    Object.freeze([2, 1]),
    Object.freeze([3, 1]),
    Object.freeze([3, 2]),
    Object.freeze([3, 3]),
    Object.freeze([3, 4]),
    Object.freeze([3, 5]),
    Object.freeze([2, 5]),
    Object.freeze([2, 6]),
    Object.freeze([2, 7]),
    Object.freeze([2, 8])
]);

const CORK_DUAL_ROUTE_ENEMY_SPAWN_ROUTES = Object.freeze([
    Object.freeze({
        gateId: 'west-upper-gate-01',
        pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
        macroCells: UPPER_ROUTE_MACRO_CELLS
    }),
    Object.freeze({
        gateId: 'west-lower-gate-01',
        pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
        macroCells: LOWER_ROUTE_MACRO_CELLS
    })
]);

const CORK_DUAL_ROUTE_GRAPH = normalizeEnemyRouteGraph({
    version: ENEMY_ROUTE_GRAPH_VERSION,
    routeSets: [
        {
            id: CORK_DUAL_ROUTE_ROUTE_SET_ID,
            candidates: [
                { pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID, priority: 0 },
                { pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID, priority: 1 }
            ],
            selectionPolicyId:
                ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY
                    .LOWEST_OPEN_PRIORITY_THEN_PATH_ID,
            noOpenRoutePolicyId:
                ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY.HOLD_AT_ENTRY
        }
    ],
    nodes: [
        {
            id: 'west-entry',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.ENTRANCE,
            memberships: [
                {
                    pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                    waypointIndex: 0,
                    progressOrdinal: 0
                },
                {
                    pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                    waypointIndex: 0,
                    progressOrdinal: 0
                }
            ]
        },
        {
            id: 'west-switch',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.SWITCH,
            memberships: [
                {
                    pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                    waypointIndex: 1,
                    progressOrdinal: 1
                },
                {
                    pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                    waypointIndex: 1,
                    progressOrdinal: 1
                }
            ]
        },
        {
            id: 'upper-clearance',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE,
            memberships: [{
                pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                waypointIndex: 3,
                progressOrdinal: 3
            }]
        },
        {
            id: 'upper-closure',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE,
            memberships: [{
                pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                waypointIndex: 4,
                progressOrdinal: 4
            }]
        },
        {
            id: 'lower-clearance',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE,
            memberships: [{
                pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                waypointIndex: 3,
                progressOrdinal: 3
            }]
        },
        {
            id: 'lower-closure',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE,
            memberships: [{
                pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                waypointIndex: 4,
                progressOrdinal: 4
            }]
        },
        {
            id: 'east-merge',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.MERGE,
            memberships: [
                {
                    pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                    waypointIndex: 7,
                    progressOrdinal: 7
                },
                {
                    pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                    waypointIndex: 7,
                    progressOrdinal: 7
                }
            ]
        },
        {
            id: 'core',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CORE,
            memberships: [
                {
                    pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                    waypointIndex: 10,
                    progressOrdinal: 10
                },
                {
                    pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                    waypointIndex: 10,
                    progressOrdinal: 10
                }
            ]
        }
    ],
    switches: [
        {
            id: 'west-forward-switch',
            nodeId: 'west-switch',
            selectionPolicyId:
                ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY
                    .OPEN_FORWARD_LOWEST_PRIORITY_PATH_ID,
            transitions: [
                {
                    fromPathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                    toPathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                    targetWaypointIndex: 2,
                    priority: 1
                },
                {
                    fromPathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                    toPathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                    targetWaypointIndex: 2,
                    priority: 0
                }
            ]
        }
    ],
    closures: [
        {
            id: CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
            pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
            entranceNodeId: 'upper-closure',
            clearanceNodeId: 'upper-clearance',
            upstreamSwitchNodeId: 'west-switch',
            downstreamMergeNodeId: 'east-merge',
            priority: 0
        },
        {
            id: CORK_DUAL_ROUTE_LOWER_CLOSURE_ID,
            pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
            entranceNodeId: 'lower-closure',
            clearanceNodeId: 'lower-clearance',
            upstreamSwitchNodeId: 'west-switch',
            downstreamMergeNodeId: 'east-merge',
            priority: 1
        }
    ]
}, {
    routes: CORK_DUAL_ROUTE_ENEMY_SPAWN_ROUTES
}, 'CORK_DUAL_ROUTE_MAP_DATA.routeGraph');

/** Turn 8 acceptance 전용 injection map이며 production map registry에는 등록하지 않습니다. */
export const CORK_DUAL_ROUTE_MAP_DATA = Object.freeze({
    id: CORK_DUAL_ROUTE_MAP_ID,
    nameKey: 'game_map_cork_dual_route_name',
    descriptionKey: 'game_map_cork_dual_route_description',
    macroRows: 5,
    macroColumns: 9,
    pathWidthTiles: 6,
    directionBlueprint: CORK_DUAL_ROUTE_DIRECTION_BLUEPRINT,
    previewTiles: CORK_DUAL_ROUTE_PREVIEW_TILES,
    enemyModifiers: CORK_DUAL_ROUTE_MAP_ENEMY_MODIFIERS,
    coreMacroCell: Object.freeze([2, 8]),
    towerSpawnMacroCell: Object.freeze([2, 7]),
    enemySpawnRoutes: CORK_DUAL_ROUTE_ENEMY_SPAWN_ROUTES,
    routeGraph: CORK_DUAL_ROUTE_GRAPH
});
