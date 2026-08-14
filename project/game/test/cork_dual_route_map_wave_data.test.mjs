import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_ROUTE_GRAPH_NODE_KIND,
    ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY,
    ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY,
    ENEMY_ROUTE_GRAPH_VERSION,
    normalizeEnemyRouteGraph
} = await loadGameModule('ingame/contract/enemy_route_closure_contract.js');
const {
    BASIC_CORK_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    CORK_ROUTE_CLOSURE_PROFILE
} = await loadGameModule(
    'data/object/enemy/enemy_route_closure_catalog_data.js'
);
const {
    CORK_DUAL_ROUTE_LOWER_CLOSURE_ID,
    CORK_DUAL_ROUTE_LOWER_PATH_ID,
    CORK_DUAL_ROUTE_MAP_DATA,
    CORK_DUAL_ROUTE_MAP_ID,
    CORK_DUAL_ROUTE_ROUTE_SET_ID,
    CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
    CORK_DUAL_ROUTE_UPPER_PATH_ID
} = await loadGameModule('data/scene/game/cork_dual_route_map_data.js');
const {
    CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS,
    CORK_DUAL_ROUTE_WAVE_01_DATA,
    CORK_DUAL_ROUTE_WAVE_01_ID
} = await loadGameModule('data/scene/game/cork_dual_route_wave_01_data.js');
const {
    CORRIDOR_EIGHT_MAP_DATA,
    INGAME_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    CORRIDOR_EIGHT_WAVE_01_DATA
} = await loadGameModule('data/scene/game/corridor_eight_wave_01_data.js');
const {
    PERFORMANCE_SERPENTINE_MAP_DATA
} = await loadGameModule(
    'data/scene/game/performance_serpentine_map_data.js'
);

function graphSource(graph, overrides = {}) {
    return {
        version: graph.version,
        routeSets: graph.routeSets,
        nodes: graph.nodes,
        switches: graph.switches,
        closures: graph.closures,
        ...overrides
    };
}

test('dedicated map은 pathWidth 6의 독립 upper/lower route와 immutable graph를 선언한다', () => {
    assert.equal(CORK_DUAL_ROUTE_MAP_ID, 'cork_dual_route_01');
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.id, CORK_DUAL_ROUTE_MAP_ID);
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.macroRows, 5);
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.macroColumns, 9);
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.pathWidthTiles, 6);
    assert.equal(
        CORK_ROUTE_CLOSURE_PROFILE.blockerDiameterTiles,
        CORK_DUAL_ROUTE_MAP_DATA.pathWidthTiles
    );
    assert.equal(
        CORK_ROUTE_CLOSURE_PROFILE.expandedRadiusTiles * 2,
        CORK_ROUTE_CLOSURE_PROFILE.blockerDiameterTiles
    );
    assert.deepEqual(CORK_DUAL_ROUTE_MAP_DATA.coreMacroCell, [2, 8]);
    assert.deepEqual(CORK_DUAL_ROUTE_MAP_DATA.towerSpawnMacroCell, [2, 7]);
    assert.deepEqual(CORK_DUAL_ROUTE_MAP_DATA.directionBlueprint, [
        '#########',
        '#abcde###',
        'fg###hijk',
        '#lmnop###',
        '#########'
    ]);
    assert.deepEqual(CORK_DUAL_ROUTE_MAP_DATA.previewTiles, [
        '.........',
        '.FFFFF...',
        'FF...FFFF',
        '.FFFFF...',
        '.........'
    ]);
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes.length, 2);
    assert.deepEqual(
        CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes.map((route) => route.pathId),
        [CORK_DUAL_ROUTE_UPPER_PATH_ID, CORK_DUAL_ROUTE_LOWER_PATH_ID]
    );
    for (const route of CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes) {
        assert.deepEqual(route.macroCells[0], [2, 0]);
        assert.deepEqual(route.macroCells[1], [2, 1]);
        assert.deepEqual(route.macroCells[7], [2, 5]);
        assert.deepEqual(route.macroCells[10], [2, 8]);
    }
    assert.deepEqual(
        CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes[0].macroCells.slice(2, 7),
        [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]
    );
    assert.deepEqual(
        CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes[1].macroCells.slice(2, 7),
        [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5]]
    );
    assert.equal(Object.isFrozen(CORK_DUAL_ROUTE_MAP_DATA.routeGraph), true);
    assert.equal('availability' in CORK_DUAL_ROUTE_MAP_DATA.routeGraph, false);
});

test('route graph은 deterministic route-set/switch와 exact closure progress를 고정한다', () => {
    const graph = CORK_DUAL_ROUTE_MAP_DATA.routeGraph;
    assert.equal(graph.version, ENEMY_ROUTE_GRAPH_VERSION);
    assert.equal(graph.routeSets.length, 1);
    assert.deepEqual(graph.routeSets[0], {
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
    });

    const nodeById = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
    assert.equal(nodeById['west-entry'].kind, ENEMY_ROUTE_GRAPH_NODE_KIND.ENTRANCE);
    assert.equal(nodeById['west-switch'].kind, ENEMY_ROUTE_GRAPH_NODE_KIND.SWITCH);
    assert.equal(nodeById['upper-clearance'].kind, ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE);
    assert.equal(
        nodeById['upper-closure'].kind,
        ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE
    );
    assert.equal(nodeById['east-merge'].kind, ENEMY_ROUTE_GRAPH_NODE_KIND.MERGE);
    assert.equal(nodeById.core.kind, ENEMY_ROUTE_GRAPH_NODE_KIND.CORE);

    assert.deepEqual(graph.switches[0], {
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
    });
    assert.deepEqual(
        graph.closures.map((closure) => ({
            id: closure.id,
            pathId: closure.pathId,
            progress: [
                nodeById[closure.upstreamSwitchNodeId].memberships.find(
                    (membership) => membership.pathId === closure.pathId
                ).progressOrdinal,
                nodeById[closure.clearanceNodeId].memberships[0].progressOrdinal,
                nodeById[closure.entranceNodeId].memberships[0].progressOrdinal,
                nodeById[closure.downstreamMergeNodeId].memberships.find(
                    (membership) => membership.pathId === closure.pathId
                ).progressOrdinal
            ],
            priority: closure.priority
        })),
        [
            {
                id: CORK_DUAL_ROUTE_UPPER_CLOSURE_ID,
                pathId: CORK_DUAL_ROUTE_UPPER_PATH_ID,
                progress: [1, 3, 4, 7],
                priority: 0
            },
            {
                id: CORK_DUAL_ROUTE_LOWER_CLOSURE_ID,
                pathId: CORK_DUAL_ROUTE_LOWER_PATH_ID,
                progress: [1, 3, 4, 7],
                priority: 1
            }
        ]
    );
});

test('route graph normalizer는 backward switch와 invalid closure order를 fail-closed한다', () => {
    const graph = CORK_DUAL_ROUTE_MAP_DATA.routeGraph;
    const routes = CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes;
    assert.throws(() => normalizeEnemyRouteGraph(graphSource(graph, {
        switches: [{
            ...graph.switches[0],
            transitions: [{
                ...graph.switches[0].transitions[0],
                targetWaypointIndex: 1
            }]
        }]
    }), { routes }), /exact next forward waypoint/);
    assert.throws(() => normalizeEnemyRouteGraph(graphSource(graph, {
        closures: [{
            ...graph.closures[0],
            entranceNodeId: 'upper-clearance',
            clearanceNodeId: 'upper-closure'
        }]
    }), { routes }), /switch < clearance < entrance < merge/);
    assert.throws(() => normalizeEnemyRouteGraph(graphSource(graph, {
        routeSets: [{
            ...graph.routeSets[0],
            candidates: [
                graph.routeSets[0].candidates[0],
                graph.routeSets[0].candidates[0]
            ]
        }]
    }), { routes }), /없거나 중복/);
});

test('route graph normalizer는 options/routes/cell을 getter-free exact own data로만 받는다', () => {
    const graph = CORK_DUAL_ROUTE_MAP_DATA.routeGraph;
    const routes = CORK_DUAL_ROUTE_MAP_DATA.enemySpawnRoutes;
    let getterCalls = 0;

    const optionsAccessor = {};
    Object.defineProperty(optionsAccessor, 'routes', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return routes;
        }
    });
    assert.throws(
        () => normalizeEnemyRouteGraph(graphSource(graph), optionsAccessor),
        /own data field/
    );
    assert.equal(getterCalls, 0);

    const routeAccessor = { ...routes[0] };
    Object.defineProperty(routeAccessor, 'pathId', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return routes[0].pathId;
        }
    });
    assert.throws(
        () => normalizeEnemyRouteGraph(
            graphSource(graph),
            { routes: [routeAccessor, routes[1]] }
        ),
        /own data field/
    );
    assert.equal(getterCalls, 0);

    const cellAccessor = [...routes[0].macroCells[0]];
    Object.defineProperty(cellAccessor, '0', {
        enumerable: true,
        get() {
            getterCalls += 1;
            return routes[0].macroCells[0][0];
        }
    });
    assert.throws(
        () => normalizeEnemyRouteGraph(graphSource(graph), {
            routes: [
                {
                    ...routes[0],
                    macroCells: [
                        cellAccessor,
                        ...routes[0].macroCells.slice(1)
                    ]
                },
                routes[1]
            ]
        }),
        /own data element/
    );
    assert.equal(getterCalls, 0);

    const routeWithHiddenExtra = { ...routes[0] };
    Object.defineProperty(routeWithHiddenExtra, 'hidden', { value: true });
    assert.throws(
        () => normalizeEnemyRouteGraph(graphSource(graph), {
            routes: [routeWithHiddenExtra, routes[1]]
        }),
        /exact schema/
    );

    const routesWithSymbol = [...routes];
    routesWithSymbol[Symbol('extra')] = true;
    assert.throws(
        () => normalizeEnemyRouteGraph(graphSource(graph), {
            routes: routesWithSymbol
        }),
        /indexed element 외 필드/
    );
});

test('dedicated authored wave는 Z 1기 후 future C 2기를 같은 routeSet에만 결합한다', () => {
    assert.equal(CORK_DUAL_ROUTE_WAVE_01_ID, 'cork_dual_route_wave_01');
    assert.equal(CORK_DUAL_ROUTE_WAVE_01_DATA.mapId, CORK_DUAL_ROUTE_MAP_ID);
    assert.equal(CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS, 15);
    assert.equal(CORK_DUAL_ROUTE_WAVE_01_DATA.timeline.length, 3);
    const [corkEntry, waitEntry, followerEntry]
        = CORK_DUAL_ROUTE_WAVE_01_DATA.timeline;
    assert.deepEqual({
        type: corkEntry.type,
        enemyDefinitionId: corkEntry.spawnGroup.enemyDefinitionId,
        count: corkEntry.spawnGroup.count,
        routeBinding: corkEntry.spawnGroup.routeBinding
    }, {
        type: 'SPAWN_GROUP',
        enemyDefinitionId: BASIC_CORK_ENEMY_DATA.id,
        count: 1,
        routeBinding: { routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID }
    });
    assert.deepEqual(waitEntry, {
        timelineEntryId: 'wait-for-travel-and-expansion',
        type: 'WAIT',
        durationSeconds: 15
    });
    assert.deepEqual({
        type: followerEntry.type,
        enemyDefinitionId: followerEntry.spawnGroup.enemyDefinitionId,
        count: followerEntry.spawnGroup.count,
        routeBinding: followerEntry.spawnGroup.routeBinding
    }, {
        type: 'SPAWN_GROUP',
        enemyDefinitionId: BASIC_SQUARE_ENEMY_DATA.id,
        count: 2,
        routeBinding: { routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID }
    });
});

test('production figure-eight map/wave는 routeGraph와 Z를 받지 않고 injection-only로 남는다', async () => {
    assert.equal(Object.hasOwn(CORRIDOR_EIGHT_MAP_DATA, 'routeGraph'), false);
    assert.equal(CORRIDOR_EIGHT_MAP_DATA.id, 'corridor_eight_01');
    assert.equal(CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes.length, 1);
    assert.equal(
        CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0].pathId,
        'west-figure-eight-core'
    );
    assert.equal(INGAME_MAP_DATA.MAPS.includes(CORK_DUAL_ROUTE_MAP_DATA), false);
    assert.deepEqual(INGAME_MAP_DATA.MAPS.map(({ id }) => id), [
        CORRIDOR_EIGHT_MAP_DATA.id,
        PERFORMANCE_SERPENTINE_MAP_DATA.id
    ]);

    const productionGroup = CORRIDOR_EIGHT_WAVE_01_DATA.timeline[0].spawnGroups[0];
    assert.equal(productionGroup.count, 32);
    assert.equal(productionGroup.intervalTicks, 5);
    assert.equal(
        productionGroup.enemyDefinitionIds.includes(BASIC_CORK_ENEMY_DATA.id),
        false
    );
    assert.deepEqual(Object.keys(productionGroup.routeBinding).sort(), [
        'gateId',
        'pathId'
    ]);

    const waveDirectorSource = await readFile(new URL(
        '../script/module/ingame/flow/wave_director.js',
        import.meta.url
    ), 'utf8');
    assert.match(waveDirectorSource, /CORRIDOR_EIGHT_WAVE_01_DATA/);
    assert.doesNotMatch(waveDirectorSource, /CORK_DUAL_ROUTE_WAVE_01_DATA/);
});
