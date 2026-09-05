import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    PERFORMANCE_SERPENTINE_MAP_DATA
} = await loadGameModule('data/scene/game/performance_serpentine_map_data.js');
const {
    CORK_DUAL_ROUTE_MAP_DATA
} = await loadGameModule('data/scene/game/cork_dual_route_map_data.js');
const {
    R2_ENEMY_SHOWCASE_MAP_DATA
} = await loadGameModule('data/scene/game/r2_enemy_showcase_map_data.js');
const {
    BASIC_CORK_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_cork_enemy_data.js');
const {
    THE_CORE_DATA
} = await loadGameModule('data/object/core/the_core_data.js');
const {
    GPU_EFFECT_RUNTIME_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_shaders.js');
const {
    GPU_ROUTE_RUNTIME_ABI,
    createGpuRouteRuntimeTopology
} = await loadGameModule('ingame/physics/gpu/gpu_route_runtime_abi.js');
const {
    GPU_ROUTE_RUNTIME_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_route_runtime_shaders.js');
const { TileMap } = await loadGameModule('ingame/map/tile_map.js');
const {
    createGpuEnemySpawnIntent,
    materializeNaturalCorkRouteClosureActivation
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    createRouteFlowFieldAtlas,
    createRouteFlowFieldRebuildAtlas
} = await loadGameModule('ingame/navigation/route_flow_field_atlas.js');

test('성능 map은 하나의 coarse route field로 10-wide lane과 stage 순서를 함께 보존한다', () => {
    const map = new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(map);
    const route = atlas.routes[0];
    const stages = atlas.stages.slice(
        route.firstFieldIndex,
        route.firstFieldIndex + route.fieldCount
    );

    assert.ok(stages.length > 2);
    assert.equal(atlas.cols, 12);
    assert.equal(atlas.rows, 7);
    assert.equal(atlas.cellSize, 10);
    assert.equal(atlas.sourceLayerCount, 1);
    assert.ok(stages.every((stage) => stage.sourceLayerIndex === 0));
    assert.equal(atlas.gpuGeneration.sourceLayerCount, 1);
    assert.equal(atlas.gpuGeneration.relaxationPassCount, 51);
    assert.ok(
        atlas.directions.byteLength
            + atlas.integrationCosts.byteLength
            + atlas.gpuGeneration.blockedLayers.byteLength
            < 1024 * 1024,
        '성능 map route atlas는 1 MiB 안에서 생성되어야 합니다.'
    );
    for (const stage of stages.slice(0, -1)) {
        assert.equal(stage.transitionRadius, 4.5);
    }
    assert.equal(
        stages.at(-1).transitionRadius,
        THE_CORE_DATA.ENEMY_IMPACT_RADIUS_TILES
    );
    assert.ok(
        stages[0].transitionRadius >= 4,
        'lane offset ±4가 waypoint 중심으로 압축되지 않아야 합니다.'
    );

    const compiledRoute = map.getSpawnRoutes()[0];
    const directionAt = (fieldIndex, x, y) => {
        const column = Math.floor((x - atlas.origin.x) / atlas.cellSize);
        const row = Math.floor((y - atlas.origin.y) / atlas.cellSize);
        const cellIndex = row * atlas.cols + column;
        const offset = ((fieldIndex * atlas.size) + cellIndex) * 2;
        return [atlas.directions[offset], atlas.directions[offset + 1]];
    };
    const horizontalFieldIndex = route.firstFieldIndex;
    const horizontalStart = compiledRoute.waypoints[0];
    const horizontalGoal = compiledRoute.waypoints[1];
    for (const laneOffset of [-4, 0, 4]) {
        assert.deepEqual(
            directionAt(
                horizontalFieldIndex,
                horizontalStart.x,
                horizontalStart.y + laneOffset
            ),
            [1, 0]
        );
        assert.deepEqual(
            directionAt(
                horizontalFieldIndex,
                horizontalGoal.x,
                horizontalGoal.y + laneOffset
            ),
            [1, 0]
        );
    }

    const firstCornerWaypointIndex = 12;
    const verticalFieldIndex = route.firstFieldIndex
        + firstCornerWaypointIndex - 1;
    const verticalStart = compiledRoute.waypoints[firstCornerWaypointIndex - 1];
    const verticalGoal = compiledRoute.waypoints[firstCornerWaypointIndex];
    for (const laneOffset of [-4, 0, 4]) {
        assert.deepEqual(
            directionAt(
                verticalFieldIndex,
                verticalStart.x + laneOffset,
                verticalStart.y
            ),
            [0, 1]
        );
        assert.deepEqual(
            directionAt(
                verticalFieldIndex,
                verticalGoal.x + laneOffset,
                verticalGoal.y
            ),
            [0, 1]
        );
    }
});

test('단일 물리 corridor는 route graph가 없고 Cork를 normal enemy로 유지한다', () => {
    const map = new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(map);
    const topology = createGpuRouteRuntimeTopology(atlas);
    assert.equal(atlas.routeGraph, null);
    assert.equal(topology.enabled, false);
    assert.equal(topology.graph ?? null, null);
    const singleRouteCorkIntent = createGpuEnemySpawnIntent({
        definition: BASIC_CORK_ENEMY_DATA,
        route: map.getSpawnRoutes()[0],
        spawnSequence: 0
    });
    const singleRouteCorkActivation
        = materializeNaturalCorkRouteClosureActivation(
            singleRouteCorkIntent,
            Object.freeze({ entityId: 1, incarnation: 1 })
        );
    assert.equal(singleRouteCorkIntent.routeSetId, null);
    assert.equal(singleRouteCorkIntent.routeGraphContentKey, null);
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            singleRouteCorkActivation,
            'routeRuntimeState'
        ),
        false,
        '단일 경로 Cork는 RouteRuntime 역할 없이 normal enemy여야 합니다.'
    );

    const dualRouteAtlas = createRouteFlowFieldAtlas(
        new TileMap(CORK_DUAL_ROUTE_MAP_DATA)
    );
    const dualRouteTopology = createGpuRouteRuntimeTopology(dualRouteAtlas);
    const dualRouteWords = new Uint32Array(dualRouteTopology.buffer);
    const closureOffsetIndex
        = GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.CLOSURE_OFFSET_WORDS
            / Uint32Array.BYTES_PER_ELEMENT;
    const dualRouteClosureOffset = dualRouteWords[closureOffsetIndex];
    const routeSetOffsetIndex
        = GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.ROUTE_SET_OFFSET_WORDS
            / Uint32Array.BYTES_PER_ELEMENT;
    const dualRouteSetOffset = dualRouteWords[routeSetOffsetIndex];
    const canonicalPath = dualRouteAtlas.routeGraph.paths[
        dualRouteAtlas.routeGraph.routeCandidates[0].pathIndex
    ];
    assert.equal(
        dualRouteWords[
            dualRouteSetOffset
                + GPU_ROUTE_RUNTIME_ABI.ROUTE_SET.CORE_FLOW_FIELD_WORD_OFFSET
        ],
        canonicalPath.firstFieldIndex + canonicalPath.fieldCount - 1
    );
    assert.ok(dualRouteAtlas.routeGraph.closures.every(
        (closure) => closure.physicalBlocking === true
    ));
    for (let closureIndex = 0;
        closureIndex < dualRouteAtlas.routeGraph.closures.length;
        closureIndex++) {
        assert.equal(
            dualRouteWords[
                dualRouteClosureOffset
                    + closureIndex * GPU_ROUTE_RUNTIME_ABI.CLOSURE.STRIDE_WORDS
                    + 13
            ],
            1
        );
    }

    const blockedRebuild = createRouteFlowFieldRebuildAtlas(
        dualRouteAtlas,
        [0]
    );
    const blockedCell = dualRouteAtlas.gpuGeneration
        .closureBlockCellIndices[0];
    const routeSetIndex = dualRouteAtlas.gpuGeneration
        .closureRouteSetIndices[0];
    for (let layerIndex = 0;
        layerIndex < dualRouteAtlas.sourceLayerCount;
        layerIndex++) {
        if (dualRouteAtlas.gpuGeneration.sourceLayerRouteSetIndices[layerIndex]
            === routeSetIndex) {
            assert.equal(
                blockedRebuild.gpuGeneration.blockedLayers[
                    (layerIndex * dualRouteAtlas.size) + blockedCell
                ],
                1
            );
        }
    }

    const showcaseAtlas = createRouteFlowFieldAtlas(
        new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA)
    );
    const showcaseGeneration = showcaseAtlas.gpuGeneration;
    const showcaseBlockedCell
        = showcaseGeneration.closureBlockCellIndices[0];
    const showcaseRouteSetIndex
        = showcaseGeneration.closureRouteSetIndices[0];
    assert.ok(showcaseGeneration.goalCellIndices.some(
        (goalCellIndex, layerIndex) => (
            showcaseGeneration.sourceLayerRouteSetIndices[layerIndex]
                === showcaseRouteSetIndex
            && goalCellIndex === showcaseBlockedCell
        )
    ), 'showcase fixture는 closure cell 자체가 stage goal인 경우를 포함해야 합니다.');
    const showcaseBlockedRebuild = createRouteFlowFieldRebuildAtlas(
        showcaseAtlas,
        [0]
    );
    const showcaseCoreGoal
        = showcaseGeneration.routeSetCoreGoalCellIndices[
            showcaseRouteSetIndex
        ];
    for (let layerIndex = 0;
        layerIndex < showcaseAtlas.sourceLayerCount;
        layerIndex++) {
        if (showcaseGeneration.sourceLayerRouteSetIndices[layerIndex]
            !== showcaseRouteSetIndex) {
            continue;
        }
        assert.equal(
            showcaseBlockedRebuild.gpuGeneration.goalCellIndices[layerIndex],
            showcaseCoreGoal
        );
        assert.notEqual(showcaseCoreGoal, showcaseBlockedCell);
        assert.equal(
            showcaseBlockedRebuild.gpuGeneration.blockedLayers[
                (layerIndex * showcaseAtlas.size) + showcaseBlockedCell
            ],
            1
        );
    }

    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /fn closure_physically_blocks\(closure_index: u32\) -> bool \{[\s\S]*?flow_ready_availability_version[\s\S]*?changed_availability_version;/u
    );
    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /if \(closure_physically_blocks\(closure_index\)\) \{[\s\S]*?make_route_blocker\(body_slot\);[\s\S]*?else \{[\s\S]*?make_nonblocking_enemy\(body_slot\);/u
    );
    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /if \(closure_physically_blocks\(action\.closure_index\)\) \{[\s\S]*?make_route_blocker\(action\.body_slot\);[\s\S]*?else \{[\s\S]*?make_nonblocking_enemy\(action\.body_slot\);/u
    );
    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /open_candidate_count <= 1u[\s\S]*?ACTION_CLEANED[\s\S]*?pack_meta\(ROLE_NORMALIZED, PHASE_NONE, 0u\)/u
    );
    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /route_set_requires_core_flow[\s\S]*?route_set_core_flow_field[\s\S]*?FLAG_REROUTE_PENDING/u
    );
});

test('Pentagon pulse는 partial grid에서 quadratic candidate scan 전에 fail-close한다', () => {
    const scanStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn scan_effect_pulse_candidates('
    );
    const scanEnd = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn prefix_effect_pulse_candidates(',
        scanStart
    );
    const scan = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.slice(scanStart, scanEnd);
    const overflowStatus = scan.indexOf(
        'atomicOr(&pool_state.status, EFFECT_STATUS_GRID_OVERFLOW);'
    );
    const enableScan = scan.indexOf(
        'atomicStore(&effect_pulse_sensor_scan_enabled, 1u);',
        overflowStatus
    );
    const candidateScan = scan.indexOf(
        'emit_effect_pulse_sensor_hits(record, local_id.x);',
        overflowStatus
    );

    assert.ok(scanStart >= 0 && scanEnd > scanStart);
    assert.ok(overflowStatus >= 0);
    assert.ok(enableScan > overflowStatus);
    assert.ok(candidateScan > enableScan);
    assert.match(
        scan.slice(overflowStatus, candidateScan),
        /if \(record_valid[\s\S]*?&& grid_complete[\s\S]*?effect_pulse_sensor_scan_enabled[\s\S]*?workgroupBarrier\(\);[\s\S]*?if \(atomicLoad\(&effect_pulse_sensor_scan_enabled\) != 0u\)/
    );
});

test('Pentagon cluster retarget은 셀마다 grid를 한 번만 읽고 field별 local count를 쓴다', () => {
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /fn cluster_member_counts\([\s\S]*?array<u32, MAX_PENTA_ROUTE_LOOKAHEAD_FIELDS>[\s\S]*?member_field_index - first_flow_field_index[\s\S]*?return counts_by_field;/u
    );
    const navigationStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn advance_penta_cluster_navigation('
    );
    const navigation = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.slice(navigationStart);
    const cellLoop = navigation.indexOf('for (var y = min_cell.y');
    const countScan = navigation.indexOf('let cluster_counts = cluster_member_counts(', cellLoop);
    const fieldLoop = navigation.indexOf('for (var candidate_field', cellLoop);

    assert.ok(navigationStart >= 0 && cellLoop >= 0);
    assert.ok(countScan > cellLoop && countScan < fieldLoop);
    assert.doesNotMatch(
        navigation.slice(fieldLoop),
        /cluster_member_counts\(/
    );
});
