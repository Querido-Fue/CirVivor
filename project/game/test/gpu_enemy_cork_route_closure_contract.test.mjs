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
const {
    GPU_EFFECT_RUNTIME_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_shaders.js');

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
        /let closure_index = path_closure\(path_index\);[\s\S]{0,500}virtual_state\[closure_index\] == AVAILABILITY_OPEN[\s\S]{0,500}virtual_owner_slot\[closure_index\] == INVALID[\s\S]{0,500}virtual_owner_entity\[closure_index\] == INVALID/);
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /set_phase\(&route_states\.values\[action\.body_slot\], PHASE_BLOCKING\)/);
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /ACTION_REOPENED[\s\S]*ACTION_CLEANED/);
});

test('EXPAND는 nonblocking이고 finalize 한 submit이 BLOCKING과 route close를 함께 확정한다', () => {
    assert.match(GPU_ROUTE_RUNTIME_WGSL,
        /phase == PHASE_EXPAND \|\| phase == PHASE_READY_TO_CLOSE[\s\S]*make_nonblocking_enemy\(body_slot\)/);
    const finalizeStart = GPU_ROUTE_RUNTIME_WGSL.indexOf(
        'fn finalize_route_runtime('
    );
    assert.notEqual(finalizeStart, -1);
    const finalizeSource = GPU_ROUTE_RUNTIME_WGSL.slice(finalizeStart);
    const blockingIndex = finalizeSource.indexOf(
        'set_phase(&route_states.values[action.body_slot], PHASE_BLOCKING)'
    );
    const blockerIndex = finalizeSource.indexOf(
        'make_route_blocker(action.body_slot)'
    );
    const availabilityIndex = finalizeSource.indexOf(
        'availability.records[closure_index].state = virtual_state[closure_index]'
    );
    assert.ok(blockingIndex >= 0
        && blockerIndex > blockingIndex
        && availabilityIndex > blockerIndex,
    'BLOCKING/ROUTE_BLOCKER/availability close는 같은 finalize 함수에 있어야 합니다.');
    assert.match(RUNNER_SOURCE, /precloseExpandNonblockingOpen/);
    assert.match(RUNNER_SOURCE, /atomicCloseBlockingAndClosed/);
    assert.match(RUNNER_SOURCE, /closeCompletion\.sourceTick/);
    assert.match(RUNNER_SOURCE, /closeCompletedVersionMatch/);
    assert.match(RUNNER_SOURCE, /readRouteAvailabilityGpuEvidence/);
    assert.match(RUNNER_SOURCE, /simulation\.buffers\.routeAvailability/);
    assert.match(RUNNER_SOURCE, /closeSubmitGpuSourceTick/);
    assert.match(RUNNER_SOURCE, /closeSubmitGpuClosedState/);
    assert.match(RUNNER_SOURCE,
        /futureQueueTick = 2 \+ Math\.round\([\s\S]*CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS \/ FIXED_DELTA/);
});

test('Effect Enemy noun은 hostile Team + interaction layer이며 physical ENEMY layer를 읽지 않는다', () => {
    assert.match(GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /body_interaction_layer\([\s\S]*INTERACTION_LAYER_ENEMY/);
    assert.match(GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /gameplay_team_id\([\s\S]*GAMEPLAY_TEAM_HOSTILE/);
    assert.doesNotMatch(GPU_EFFECT_RUNTIME_COMPUTE_WGSL, /BODY_LAYER_ENEMY/);
    assert.doesNotMatch(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /body_layer\s*==\s*[^\n]*ENEMY/
    );
    assert.match(RUNNER_SOURCE, /createBlockingCorkBoostPulse/);
    assert.match(RUNNER_SOURCE, /GPU_EFFECT_EVENT_TYPE\.INSTANCE_APPLIED/);
    assert.match(RUNNER_SOURCE, /blockingCorkBoostApplied/);
    assert.match(RUNNER_SOURCE, /boostStackCount/);
});

test('formation mid-spawn 계약은 폐쇄 backlog와 원래 route의 whole-row 재개를 hard-gate한다', () => {
    for (const marker of [
        'runFormationRouteClosurePolicy',
        'closeSinkCallCount',
        'backlogRetained',
        'reopenedOnOriginalPath',
        'partialRowCount',
        'arbitraryRowSplit'
    ]) {
        assert.ok(RUNNER_SOURCE.includes(marker), `formation marker 누락: ${marker}`);
    }
    assert.match(RUNNER_SOURCE, /member-1-0,member-1-1/);
});

test('Cork actual runner는 A/M/O WAIT와 R/J/H 독립 side-plane 보존을 GPU readback으로 증명한다', () => {
    for (const marker of [
        'WAITING_BEHAVIOR_ACTORS',
        'REROUTE_OR_WAIT_ACTORS',
        'routeEntryFor(tick63Evidence',
        'body.enemyBehaviorState?.programId',
        'readProjectileCaptureState',
        'simulation.buffers.projectileCaptureStates',
        'ringCaptureState.role',
        'jorangBody.atomicTransformState.phase',
        'readGpuFormationBodyState',
        'ringCaptureStatePreserved',
        'jorangAtomicStatePreserved',
        'hexaFormationStateActive',
        'recoveryRequired: false'
    ]) {
        assert.ok(RUNNER_SOURCE.includes(marker), `cross-system marker 누락: ${marker}`);
    }
    assert.match(RUNNER_SOURCE,
        /after\?\.routeState\.phase === GPU_ROUTE_RUNTIME_PHASE\.WAITING/);
    assert.match(RUNNER_SOURCE,
        /after\?\.routeState\.currentPathIndex === lowerPathIndex/);
    assert.match(RUNNER_SOURCE, /const MAIN_HARNESS_CAPACITY = 20/);
    assert.match(RUNNER_SOURCE, /const MAIN_EXPECTED_PEAK_ACTIVE_COUNT = 13/);
    assert.match(RUNNER_SOURCE, /peakActiveCount === MAIN_EXPECTED_PEAK_ACTIVE_COUNT/);
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
