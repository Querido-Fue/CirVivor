import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_ROUTE_RUNTIME_ABI,
    GPU_ROUTE_RUNTIME_ABI_VERSION,
    GPU_ROUTE_RUNTIME_MAX_CLOSERS,
    GPU_ROUTE_RUNTIME_PHASE,
    GPU_ROUTE_RUNTIME_ROLE
} = await loadGameModule('ingame/physics/gpu/gpu_route_runtime_abi.js');
const {
    GPU_ROUTE_RUNTIME_ENTRY_POINT,
    GPU_ROUTE_RUNTIME_STORAGE_PROFILE,
    GPU_ROUTE_RUNTIME_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_route_runtime_shaders.js');
const {
    ROUTE_AVAILABILITY_MAX_CORK_ROSTER
} = await loadGameModule('ingame/contract/route_availability_contract.js');
const {
    CORK_DUAL_ROUTE_MAP_DATA,
    CORK_DUAL_ROUTE_ROUTE_SET_ID
} = await loadGameModule('data/scene/game/cork_dual_route_map_data.js');
const {
    CORK_EXPANDED_RADIUS_TILES,
    CORK_EXPANSION_DURATION_FIXED_TICKS
} = await loadGameModule(
    'data/object/enemy/enemy_route_closure_catalog_data.js'
);

const RUNNER_SOURCE = await readFile(new URL(
    './nw_webgpu_capability/enemy_cork_route_closure_runner.js',
    import.meta.url
), 'utf8');
const SUPPORT_SOURCE = await readFile(new URL(
    './support/run_nw_webgpu_capability.mjs',
    import.meta.url
), 'utf8');
const SIMULATION_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');

test('RouteRuntime ABI v1은 독립 64-byte body/availability/cleanup plane을 고정한다', () => {
    assert.equal(GPU_ROUTE_RUNTIME_ABI_VERSION, 1);
    assert.equal(GPU_ROUTE_RUNTIME_MAX_CLOSERS, 8);
    assert.equal(ROUTE_AVAILABILITY_MAX_CORK_ROSTER, 8);
    assert.equal(GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE, 64);
    assert.equal(GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.STRIDE, 96);
    assert.equal(GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_HEADER.STRIDE, 64);
    assert.equal(GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_RECORD.STRIDE, 32);
    assert.equal(GPU_ROUTE_RUNTIME_ABI.CLEANUP_HEADER.STRIDE, 32);
    assert.equal(GPU_ROUTE_RUNTIME_ABI.CLEANUP_RECORD.STRIDE, 32);
    assert.deepEqual(GPU_ROUTE_RUNTIME_ROLE, {
        NONE: 0,
        ACTOR: 1,
        CLOSER: 2
    });
    assert.deepEqual(GPU_ROUTE_RUNTIME_PHASE, {
        NONE: 0,
        SELECT_ROUTE: 1,
        TRAVEL: 2,
        EXPAND: 3,
        READY_TO_CLOSE: 4,
        BLOCKING: 5,
        WAITING: 6,
        DEAD: 7
    });
});

test('Z expansion/closure는 immutable graph 위의 exact one-owner action이다', () => {
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.routeGraph.version, 1);
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.routeGraph.routeSets[0].id,
        CORK_DUAL_ROUTE_ROUTE_SET_ID);
    assert.equal(CORK_DUAL_ROUTE_MAP_DATA.routeGraph.closures.length, 2);
    assert.equal(CORK_EXPANDED_RADIUS_TILES, 3);
    assert.equal(CORK_EXPANSION_DURATION_FIXED_TICKS, 60);
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /virtual_state\[selected_closure\] == AVAILABILITY_OPEN/);
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /virtual_owner_entity\[selected_closure\] == INVALID/);
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /set_phase\(&route_states\.values\[action\.body_slot\], PHASE_BLOCKING\)/);
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /ACTION_REOPENED[\s\S]*ACTION_CLEANED/);
});

test('route blocker는 Enemy/Tower만 물리 차단하고 projectile interaction은 유지한다', () => {
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /BODY_LAYER_ROUTE_BLOCKER[\s\S]*BODY_LAYER_ENEMY \| BODY_LAYER_KINEMATIC/);
    assert.doesNotMatch(GPU_ROUTE_RUNTIME_WGSL,
        /BODY_LAYER_ROUTE_BLOCKER[\s\S]{0,100}BODY_LAYER_PROJECTILE/);
    assert.match(RUNNER_SOURCE, /projectilePhysicallyPassed/);
    assert.match(RUNNER_SOURCE, /projectileDamagedCork/);
    assert.match(RUNNER_SOURCE, /projectilePenetrationRemaining/);
});

test('dedicated actual-hardware stage는 production Endpoint/Director/body readback만 사용한다', () => {
    assert.match(SUPPORT_SOURCE, /enemy-cork-route-closure/);
    assert.match(SUPPORT_SOURCE, /enemy_cork_route_closure_runner\.js/);
    assert.match(RUNNER_SOURCE, /new GpuEnemySimulationEndpoint/);
    assert.match(RUNNER_SOURCE, /new CorkRouteClosureDirector/);
    assert.match(RUNNER_SOURCE, /readbackBodies\(\)/);
    assert.match(RUNNER_SOURCE,
        /commitCompletedRouteAvailabilityProgramsAtFixedBoundary/);
    assert.doesNotMatch(RUNNER_SOURCE, /syntheticSuccess|mockBackend|fakeCompletion/);
});

test('RouteRuntime 모든 compute entry point는 storage binding 9 이하를 유지한다', () => {
    assert.deepEqual(GPU_ROUTE_RUNTIME_ENTRY_POINT, {
        ADVANCE: 'advance_route_runtime',
        ENFORCE_WAIT: 'enforce_route_owned_wait_after_external_motion',
        FINALIZE: 'finalize_route_runtime'
    });
    const values = [
        ...Object.values(GPU_ROUTE_RUNTIME_STORAGE_PROFILE.byEntryPoint),
        GPU_ROUTE_RUNTIME_STORAGE_PROFILE.maximum,
        GPU_ROUTE_RUNTIME_STORAGE_PROFILE.render
    ];
    assert.ok(values.length > 0);
    assert.ok(values.every((value) => Number.isSafeInteger(value)
        && value > 0 && value <= 9));
    assert.equal(Math.max(...values), 9);
    assert.match(SIMULATION_SOURCE, /routeRuntimeStates/);
    assert.match(SIMULATION_SOURCE, /routeAvailability/);
});
