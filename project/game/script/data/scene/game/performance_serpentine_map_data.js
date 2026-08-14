import {
    ENEMY_ROUTE_GRAPH_NODE_KIND,
    ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY,
    ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_VERSION,
    normalizeEnemyRouteGraph
} from 'ingame/contract/enemy_route_closure_contract.js';

export const PERFORMANCE_SERPENTINE_MAP_ID = 'performance_serpentine_02';
export const PERFORMANCE_SERPENTINE_GATE_ID = 'performance-west-gate';
export const PERFORMANCE_SERPENTINE_PATH_ID = 'performance-serpentine-core';
export const PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID
    = 'performance-serpentine-core-fallback';
export const PERFORMANCE_SERPENTINE_ROUTE_SET_ID
    = 'performance-serpentine-route-set';
export const PERFORMANCE_SERPENTINE_MACRO_ROWS = 17;
export const PERFORMANCE_SERPENTINE_MACRO_COLUMNS = 12;
export const PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES = 10;

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
 * 폭 10짜리 수평 통로 9개를 한 칸짜리 수직 굴곡으로 번갈아 연결합니다.
 * 같은 행 사이에는 빈 macro row가 있으므로 인접한 평행 통로로 건너뛰지 않고,
 * 오직 ㄹ자 순서로 116개 waypoint를 통과합니다.
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
const PERFORMANCE_SERPENTINE_FALLBACK_ROUTE = Object.freeze({
    gateId: 'performance-west-fallback-gate',
    pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
    macroCells: PERFORMANCE_SERPENTINE_MACRO_CELLS
});
const PERFORMANCE_SERPENTINE_ROUTES = Object.freeze([
    PERFORMANCE_SERPENTINE_ROUTE,
    PERFORMANCE_SERPENTINE_FALLBACK_ROUTE
]);
const PERFORMANCE_SERPENTINE_ROUTE_GRAPH = normalizeEnemyRouteGraph({
    version: ENEMY_ROUTE_GRAPH_VERSION,
    routeSets: [{
        id: PERFORMANCE_SERPENTINE_ROUTE_SET_ID,
        candidates: [
            { pathId: PERFORMANCE_SERPENTINE_PATH_ID, priority: 0 },
            { pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID, priority: 1 }
        ],
        selectionPolicyId:
            ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY
                .LOWEST_OPEN_PRIORITY_THEN_PATH_ID,
        noOpenRoutePolicyId:
            ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY.HOLD_AT_ENTRY
    }],
    nodes: [
        {
            id: 'performance-entry',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.ENTRANCE,
            memberships: [
                { pathId: PERFORMANCE_SERPENTINE_PATH_ID,
                    waypointIndex: 0, progressOrdinal: 0 },
                { pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                    waypointIndex: 0, progressOrdinal: 0 }
            ]
        },
        {
            id: 'performance-switch',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.SWITCH,
            memberships: [
                { pathId: PERFORMANCE_SERPENTINE_PATH_ID,
                    waypointIndex: 1, progressOrdinal: 1 },
                { pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                    waypointIndex: 1, progressOrdinal: 1 }
            ]
        },
        {
            id: 'performance-primary-clearance',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE,
            memberships: [{ pathId: PERFORMANCE_SERPENTINE_PATH_ID,
                waypointIndex: 2, progressOrdinal: 2 }]
        },
        {
            id: 'performance-primary-closure',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE,
            memberships: [{ pathId: PERFORMANCE_SERPENTINE_PATH_ID,
                waypointIndex: 3, progressOrdinal: 3 }]
        },
        {
            id: 'performance-fallback-clearance',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE,
            memberships: [{ pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                waypointIndex: 2, progressOrdinal: 2 }]
        },
        {
            id: 'performance-fallback-closure',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE,
            memberships: [{ pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                waypointIndex: 3, progressOrdinal: 3 }]
        },
        {
            id: 'performance-merge',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.MERGE,
            memberships: [
                { pathId: PERFORMANCE_SERPENTINE_PATH_ID,
                    waypointIndex: 4, progressOrdinal: 4 },
                { pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                    waypointIndex: 4, progressOrdinal: 4 }
            ]
        },
        {
            id: 'performance-core',
            kind: ENEMY_ROUTE_GRAPH_NODE_KIND.CORE,
            memberships: [
                { pathId: PERFORMANCE_SERPENTINE_PATH_ID,
                    waypointIndex: 115, progressOrdinal: 115 },
                { pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                    waypointIndex: 115, progressOrdinal: 115 }
            ]
        }
    ],
    switches: [{
        id: 'performance-forward-switch',
        nodeId: 'performance-switch',
        selectionPolicyId:
            ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY
                .OPEN_FORWARD_LOWEST_PRIORITY_PATH_ID,
        transitions: [
            {
                fromPathId: PERFORMANCE_SERPENTINE_PATH_ID,
                toPathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                targetWaypointIndex: 2,
                priority: 1
            },
            {
                fromPathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
                toPathId: PERFORMANCE_SERPENTINE_PATH_ID,
                targetWaypointIndex: 2,
                priority: 0
            }
        ]
    }],
    closures: [
        {
            id: 'performance-primary-cork',
            pathId: PERFORMANCE_SERPENTINE_PATH_ID,
            entranceNodeId: 'performance-primary-closure',
            clearanceNodeId: 'performance-primary-clearance',
            upstreamSwitchNodeId: 'performance-switch',
            downstreamMergeNodeId: 'performance-merge',
            priority: 0
        },
        {
            id: 'performance-fallback-cork',
            pathId: PERFORMANCE_SERPENTINE_FALLBACK_PATH_ID,
            entranceNodeId: 'performance-fallback-closure',
            clearanceNodeId: 'performance-fallback-clearance',
            upstreamSwitchNodeId: 'performance-switch',
            downstreamMergeNodeId: 'performance-merge',
            priority: 1
        }
    ]
}, {
    routes: PERFORMANCE_SERPENTINE_ROUTES
}, 'PERFORMANCE_SERPENTINE_MAP_DATA.routeGraph');

/** 실제 10,000-body 성능 검증을 위한 두 번째 production map입니다. */
export const PERFORMANCE_SERPENTINE_MAP_DATA = Object.freeze({
    id: PERFORMANCE_SERPENTINE_MAP_ID,
    nameKey: 'game_map_performance_serpentine_name',
    descriptionKey: 'game_map_performance_serpentine_description',
    macroRows: PERFORMANCE_SERPENTINE_MACRO_ROWS,
    macroColumns: PERFORMANCE_SERPENTINE_MACRO_COLUMNS,
    pathWidthTiles: PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES,
    directionBlueprint: DIRECTION_BLUEPRINT,
    previewTiles: PREVIEW_TILES,
    enemyModifiers: IDENTITY_ENEMY_MODIFIERS,
    coreMacroCell: Object.freeze([16, 11]),
    towerSpawnMacroCell: Object.freeze([16, 10]),
    enemySpawnRoutes: PERFORMANCE_SERPENTINE_ROUTES,
    routeGraph: PERFORMANCE_SERPENTINE_ROUTE_GRAPH
});
