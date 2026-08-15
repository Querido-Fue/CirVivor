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
    createRouteFlowFieldAtlas
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
    assert.equal(atlas.rows, 17);
    assert.equal(atlas.cellSize, 10);
    assert.equal(atlas.sourceLayerCount, 1);
    assert.ok(stages.every((stage) => stage.sourceLayerIndex === 0));
    assert.equal(atlas.gpuGeneration.sourceLayerCount, 1);
    assert.equal(atlas.gpuGeneration.relaxationPassCount, 116);
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
    assert.equal(stages.at(-1).transitionRadius, 0.75);
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

test('단일 물리 corridor의 Cork는 route만 닫고 GPU 충돌 벽은 만들지 않는다', () => {
    const map = new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(map);
    assert.ok(atlas.routeGraph.closures.length > 0);
    assert.ok(atlas.routeGraph.closures.every(
        (closure) => closure.physicalBlocking === false
    ));

    const topology = createGpuRouteRuntimeTopology(atlas);
    const words = new Uint32Array(topology.buffer);
    const closureOffsetIndex
        = GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.CLOSURE_OFFSET_WORDS
            / Uint32Array.BYTES_PER_ELEMENT;
    const closureOffset = words[closureOffsetIndex];
    for (let closureIndex = 0;
        closureIndex < atlas.routeGraph.closures.length;
        closureIndex++) {
        const physicalBlocking = words[
            closureOffset
                + closureIndex * GPU_ROUTE_RUNTIME_ABI.CLOSURE.STRIDE_WORDS
                + 13
        ];
        assert.equal(physicalBlocking, 0);
    }

    const dualRouteAtlas = createRouteFlowFieldAtlas(
        new TileMap(CORK_DUAL_ROUTE_MAP_DATA)
    );
    const dualRouteTopology = createGpuRouteRuntimeTopology(dualRouteAtlas);
    const dualRouteWords = new Uint32Array(dualRouteTopology.buffer);
    const dualRouteClosureOffset = dualRouteWords[closureOffsetIndex];
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

    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /fn closure_physically_blocks\(closure_index: u32\) -> bool \{[\s\S]*?closure_base\(closure_index\) \+ 13u[\s\S]*?!= 0u;/u
    );
    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /if \(closure_physically_blocks\(closure_index\)\) \{[\s\S]*?make_route_blocker\(body_slot\);[\s\S]*?else \{[\s\S]*?make_nonblocking_enemy\(body_slot\);/u
    );
    assert.match(
        GPU_ROUTE_RUNTIME_WGSL,
        /if \(closure_physically_blocks\(action\.closure_index\)\) \{[\s\S]*?make_route_blocker\(action\.body_slot\);[\s\S]*?else \{[\s\S]*?make_nonblocking_enemy\(action\.body_slot\);/u
    );
    const actorStart = GPU_ROUTE_RUNTIME_WGSL.indexOf('if (role == ROLE_ACTOR)');
    const closerStart = GPU_ROUTE_RUNTIME_WGSL.indexOf(
        'if (role != ROLE_CLOSER)',
        actorStart
    );
    const actorProgram = GPU_ROUTE_RUNTIME_WGSL.slice(actorStart, closerStart);
    const nonphysicalReturn = actorProgram.indexOf(
        'if (!closure_physically_blocks(closure_index))'
    );
    const clearanceWait = actorProgram.indexOf(
        'let clearance_progress = topology.values[closure + 8u]'
    );
    assert.ok(nonphysicalReturn >= 0 && nonphysicalReturn < clearanceWait);
    assert.match(
        actorProgram.slice(nonphysicalReturn, clearanceWait),
        /observed_availability_version[\s\S]*?return;/u
    );
});

test('Pentagon pulse는 partial grid에서 quadratic candidate scan 전에 fail-close한다', () => {
    const scanStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn scan_effect_pulse_candidates('
    );
    const scanEnd = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn write_effect_event(',
        scanStart
    );
    const scan = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.slice(scanStart, scanEnd);
    const overflowStatus = scan.indexOf(
        'atomicOr(&pool_state.status, EFFECT_STATUS_GRID_OVERFLOW);'
    );
    const overflowReturn = scan.indexOf('return;', overflowStatus);
    const candidateLoops = scan.indexOf('for (var pulse_index', overflowStatus);

    assert.ok(scanStart >= 0 && scanEnd > scanStart);
    assert.ok(overflowStatus >= 0);
    assert.ok(overflowReturn > overflowStatus);
    assert.ok(candidateLoops > overflowReturn);
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
