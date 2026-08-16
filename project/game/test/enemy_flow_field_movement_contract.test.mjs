import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_CORK_ENEMY_DATA,
    INGAME_ENEMY_DEFINITION_BY_ID
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    ENEMY_PROFILE_CATALOG
} = await loadGameModule('data/object/enemy/enemy_profile_catalog_data.js');
const {
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    resolveEnemyDefinitionProfiles
} = await loadGameModule('ingame/contract/enemy_profile_contract.js');
const {
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    GPU_COLLISION_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');

const FIXTURE_ROUTE = Object.freeze({
    gateId: 'all-enemy-flow-gate',
    pathId: 'all-enemy-flow-path',
    waypoints: Object.freeze([
        Object.freeze({ x: 4, y: 8 }),
        Object.freeze({ x: 7, y: 12 })
    ])
});
const CORK_ROUTE_SNAPSHOT = Object.freeze({
    routeSetId: 'all-enemy-flow-route-set',
    routeAvailabilityVersion: 1,
    routeGraphContentKey: 'all-enemy-flow-route-graph-v1'
});
const EXPECTED_DEFAULT_SPEED_BY_DEFINITION_ID = Object.freeze({
    basic_square_01: 5,
    basic_triangle_01: 7,
    basic_arrow_01: 5,
    basic_penta_01: 5,
    basic_hexa_01: 5,
    basic_gen_01: 5,
    basic_rhom_01: 5,
    'basic-octa-enemy': 5,
    basic_ring_01: 5,
    basic_cork_01: 5,
    basic_circle_01: 5,
    'performance-octa-core-route-01': 5,
    archer_01: 5
});
const EXPECTED_NAVIGATION_MODES = Object.freeze(new Set([
    'route-flow-field',
    'gpu-exact-tower-charge',
    'gpu-hexa-formation-route',
    'gpu-core-priority-ranged',
    'gpu-exact-tower-orbit',
    'gpu-route-closure'
]));
const assertClose = (actual, expected, label) => assert.ok(
    Math.abs(actual - expected) <= 1e-12,
    `${label}: expected ${actual} to equal ${expected}`
);

test('모든 natural enemy는 2배 기본 속도와 immutable route-flow spawn authority를 갖는다', () => {
    const definitions = Object.values(INGAME_ENEMY_DEFINITION_BY_ID);
    assert.deepEqual(
        definitions.map(({ id }) => id).sort(),
        Object.keys(EXPECTED_DEFAULT_SPEED_BY_DEFINITION_ID).sort()
    );

    const segmentX = FIXTURE_ROUTE.waypoints[1].x - FIXTURE_ROUTE.waypoints[0].x;
    const segmentY = FIXTURE_ROUTE.waypoints[1].y - FIXTURE_ROUTE.waypoints[0].y;
    const inverseLength = 1 / Math.hypot(segmentX, segmentY);

    for (const [index, definition] of definitions.entries()) {
        const expectedSpeed = EXPECTED_DEFAULT_SPEED_BY_DEFINITION_ID[definition.id];
        const behavior = resolveEnemyDefinitionProfiles(
            definition,
            ENEMY_PROFILE_CATALOG
        ).behavior;
        assert.equal(definition.spawnPolicy, 'natural', definition.id);
        assert.equal(
            definition.capabilityIds.includes(ENEMY_CAPABILITY_ID.NAVIGATION),
            true,
            definition.id
        );
        assert.equal(
            EXPECTED_NAVIGATION_MODES.has(behavior.navigationMode),
            true,
            `${definition.id}:${behavior.navigationMode}`
        );
        assert.equal(behavior.moveSpeedTilesPerSecond, expectedSpeed, definition.id);
        assert.equal(definition.moveSpeedTilesPerSecond, expectedSpeed, definition.id);

        const intent = createGpuEnemySpawnIntent({
            definition,
            route: FIXTURE_ROUTE,
            spawnSequence: index,
            ...(definition === BASIC_CORK_ENEMY_DATA
                ? CORK_ROUTE_SNAPSHOT
                : null)
        });
        assert.equal(intent.pathId, FIXTURE_ROUTE.pathId, definition.id);
        assert.equal(intent.waypointIndex, 1, definition.id);
        assert.equal(intent.flowSpeed, Math.fround(expectedSpeed), definition.id);
        assertClose(
            intent.velocity.x,
            segmentX * inverseLength * expectedSpeed,
            definition.id
        );
        assertClose(
            intent.velocity.y,
            segmentY * inverseLength * expectedSpeed,
            definition.id
        );
    }
});

test('GPU fixed prepare는 route atlas 방향을 flow speed 상한으로 매 tick 소유한다', () => {
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /body_has_flag\(simulation_flags, BODY_FLAG_USE_FLOW\)[\s\S]*?flow_direction\(field_index, cell\)[\s\S]*?simulations\.values\[body_id\]\.flow_speed/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn restore_enemy_route_flow\(body_id: u32\)[\s\S]*?BODY_FLAG_USE_FLOW/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn enter_enemy_core_fallback\(body_id: u32\)[\s\S]*?restore_enemy_route_flow\(body_id\)/u
    );
});
