import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_CORK_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_JORANG_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_RING_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    MAIN_GPU_ENEMY_COLOR_RGBA,
    PERFORMANCE_OCTA_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    ENEMY_CAPABILITY_ID
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    PERFORMANCE_SERPENTINE_MACRO_COLUMNS,
    PERFORMANCE_SERPENTINE_MACRO_ROWS,
    PERFORMANCE_SERPENTINE_FLOW_TRANSITION_RADIUS_TILES,
    PERFORMANCE_SERPENTINE_MAP_DATA,
    PERFORMANCE_SERPENTINE_MAP_ID,
    PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES
} = await loadGameModule(
    'data/scene/game/performance_serpentine_map_data.js'
);
const {
    PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS,
    PERFORMANCE_SERPENTINE_LANE_OFFSETS_TILES,
    PERFORMANCE_SERPENTINE_SESSION,
    PERFORMANCE_SERPENTINE_SPAWN_INTERVAL_TICKS,
    PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT,
    PERFORMANCE_SERPENTINE_WAVE_01_DATA
} = await loadGameModule(
    'data/scene/game/performance_serpentine_wave_data.js'
);
const {
    GPU_COLLISION_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const { TileMap } = await loadGameModule('ingame/map/tile_map.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');

const PERFORMANCE_DEFINITIONS = Object.freeze([
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA,
    BASIC_ARROW_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    PERFORMANCE_OCTA_ENEMY_DATA,
    BASIC_JORANG_ENEMY_DATA,
    BASIC_RING_ENEMY_DATA,
    BASIC_CORK_ENEMY_DATA
]);

test('두 번째 성능 map은 폭 10의 단일 51-waypoint 4줄 통로다', () => {
    assert.equal(PERFORMANCE_SERPENTINE_MAP_ID, 'performance_serpentine_02');
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.id,
        PERFORMANCE_SERPENTINE_MAP_ID);
    assert.equal(PERFORMANCE_SERPENTINE_MACRO_ROWS, 7);
    assert.equal(PERFORMANCE_SERPENTINE_MACRO_COLUMNS, 12);
    assert.equal(PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES, 10);
    assert.equal(PERFORMANCE_SERPENTINE_FLOW_TRANSITION_RADIUS_TILES, 4.5);
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.pathWidthTiles, 10);
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.flowTransitionRadiusTiles, 4.5);
    assert.equal('routeClosurePhysicalBlocking' in PERFORMANCE_SERPENTINE_MAP_DATA, false);
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.enemySpawnRoutes.length, 1);

    const route = PERFORMANCE_SERPENTINE_MAP_DATA.enemySpawnRoutes[0];
    assert.equal(route.macroCells.length, 51);
    assert.deepEqual(route.macroCells[0], [0, 0]);
    assert.deepEqual(route.macroCells.at(-1), [6, 0]);
    assert.deepEqual(PERFORMANCE_SERPENTINE_MAP_DATA.coreMacroCell, [6, 0]);
    assert.deepEqual(PERFORMANCE_SERPENTINE_MAP_DATA.towerSpawnMacroCell,
        [6, 1]);
    assert.equal(new Set(route.macroCells.map(
        ([row, column]) => `${row}:${column}`
    )).size, route.macroCells.length);
    for (let index = 1; index < route.macroCells.length; index++) {
        const [row, column] = route.macroCells[index];
        const [previousRow, previousColumn] = route.macroCells[index - 1];
        assert.equal(
            Math.abs(row - previousRow) + Math.abs(column - previousColumn),
            1,
            `route ${index - 1}→${index}는 orthogonal neighbor여야 합니다.`
        );
    }

    const tileMap = new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA);
    assert.equal(tileMap.rows, 70);
    assert.equal(tileMap.columns, 120);
    assert.equal(tileMap.getSpawnRoutes().length, 1);
    assert.equal(tileMap.getSpawnRoutes()[0].waypoints.length, 51);
    assert.equal(tileMap.getFlowTransitionRadius(), 4.5);
    assert.equal(tileMap.getRouteClosurePhysicalBlocking(), true);
    assert.equal(tileMap.getRouteGraph(), null);
});

test('성능 wave는 10종을 같은 비율로 1 tick 간격에 총 10,000개 예약한다', () => {
    assert.equal(PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT, 10_000);
    assert.equal(PERFORMANCE_SERPENTINE_SPAWN_INTERVAL_TICKS, 1);
    assert.equal(PERFORMANCE_SERPENTINE_LANE_OFFSETS_TILES.length, 10);
    assert.deepEqual(Array.from(PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS), [
        BASIC_CIRCLE_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id,
        BASIC_ARROW_ENEMY_DATA.id,
        BASIC_RHOM_ENEMY_DATA.id,
        BASIC_PENTA_ENEMY_DATA.id,
        BASIC_HEXA_ENEMY_DATA.id,
        PERFORMANCE_OCTA_ENEMY_DATA.id,
        BASIC_JORANG_ENEMY_DATA.id,
        BASIC_RING_ENEMY_DATA.id,
        BASIC_CORK_ENEMY_DATA.id
    ]);
    assert.deepEqual({ ...PERFORMANCE_SERPENTINE_SESSION }, {
        towerMaxHp: 20_000_000,
        coreMaxIntegrity: 20_000_000
    });
    assert.equal(PERFORMANCE_SERPENTINE_WAVE_01_DATA.timeline.length, 1);
    assert.equal(
        PERFORMANCE_SERPENTINE_WAVE_01_DATA.timeline[0].spawnGroups[0].count,
        10_000
    );

    assert.notEqual(PERFORMANCE_OCTA_ENEMY_DATA.id, BASIC_OCTA_ENEMY_DATA.id);
    assert.equal(
        PERFORMANCE_OCTA_ENEMY_DATA.shapeType,
        BASIC_OCTA_ENEMY_DATA.shapeType
    );
    assert.equal(
        PERFORMANCE_OCTA_ENEMY_DATA.physicsProfileId,
        BASIC_OCTA_ENEMY_DATA.physicsProfileId
    );
    assert.notEqual(
        PERFORMANCE_OCTA_ENEMY_DATA.behaviorProfileId,
        BASIC_OCTA_ENEMY_DATA.behaviorProfileId
    );
    assert.equal(
        PERFORMANCE_OCTA_ENEMY_DATA.capabilityIds.includes(
            ENEMY_CAPABILITY_ID.ORBIT
        ),
        false,
        '부하용 O가 자연 O의 bounded orbit roster를 소비하면 안 됩니다.'
    );
    assert.equal(
        PERFORMANCE_OCTA_ENEMY_DATA.capabilityIds.includes(
            ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE
        ),
        false
    );

    for (const definition of PERFORMANCE_DEFINITIONS) {
        assert.deepEqual(
            Array.from(definition.colorRgba),
            Array.from(MAIN_GPU_ENEMY_COLOR_RGBA),
            `${definition.id}는 공통 hostile RGBA를 완전히 가져야 합니다.`
        );
        assert.equal(definition.colorRgba.length, 4);
        assert.equal(definition.colorRgba[3], 1);
        assert.ok(definition.radiusScale > 0);
    }

    const director = new WaveDirector({
        waveDefinition: PERFORMANCE_SERPENTINE_WAVE_01_DATA
    });
    assert.equal(director.init(new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA)), true);
    assert.equal(director.schedule.length, 10_000);
    assert.equal(director.schedule[0].targetFixedTick, 1);
    assert.equal(director.schedule.at(-1).targetFixedTick, 10_000);
    assert.deepEqual(director.schedule.slice(0, 10).map(
        ({ definition }) => definition.id
    ), Array.from(PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS));
    for (let index = 1; index < director.schedule.length; index++) {
        assert.equal(
            director.schedule[index].targetFixedTick
                - director.schedule[index - 1].targetFixedTick,
            1
        );
    }
    const counts = director.schedule.reduce((result, entry) => {
        result[entry.definition.id] = (result[entry.definition.id] ?? 0) + 1;
        return result;
    }, {});
    assert.deepEqual(counts, {
        [BASIC_CIRCLE_ENEMY_DATA.id]: 1_000,
        [BASIC_TRIANGLE_ENEMY_DATA.id]: 1_000,
        [BASIC_ARROW_ENEMY_DATA.id]: 1_000,
        [BASIC_RHOM_ENEMY_DATA.id]: 1_000,
        [BASIC_PENTA_ENEMY_DATA.id]: 1_000,
        [BASIC_HEXA_ENEMY_DATA.id]: 1_000,
        [PERFORMANCE_OCTA_ENEMY_DATA.id]: 1_000,
        [BASIC_JORANG_ENEMY_DATA.id]: 1_000,
        [BASIC_RING_ENEMY_DATA.id]: 1_000,
        [BASIC_CORK_ENEMY_DATA.id]: 1_000
    });
    director.destroy();
});

test('성능 map Arrow도 production direct-speed와 physical impact를 사용한다', () => {
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /physics\.values\[body_id\]\.velocity = direction[\s\S]*?enemy_behavior_states\.values\[body_id\]\.charge_speed/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn materialize_enemy_charge_impact_evidence\(/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /normal_impulse_magnitude = -\(1\.0 \+ restitution\)/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn apply_enemy_charge_impact_impulses\(/u
    );
    assert.doesNotMatch(
        GPU_COLLISION_COMPUTE_WGSL,
        /enemy_charge_accelerated_velocity|normalized_bounded_recoil_expo_out/u
    );
    assert.doesNotMatch(
        GPU_COLLISION_COMPUTE_WGSL,
        /enemy_recoil_expo_out_velocity/u
    );
});
