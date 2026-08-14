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
    BASIC_TRIANGLE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    PERFORMANCE_SERPENTINE_MACRO_COLUMNS,
    PERFORMANCE_SERPENTINE_MACRO_ROWS,
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

test('두 번째 성능 map은 폭 10의 단일 116-waypoint ㄹ자 통로다', () => {
    assert.equal(PERFORMANCE_SERPENTINE_MAP_ID, 'performance_serpentine_02');
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.id,
        PERFORMANCE_SERPENTINE_MAP_ID);
    assert.equal(PERFORMANCE_SERPENTINE_MACRO_ROWS, 17);
    assert.equal(PERFORMANCE_SERPENTINE_MACRO_COLUMNS, 12);
    assert.equal(PERFORMANCE_SERPENTINE_PATH_WIDTH_TILES, 10);
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.pathWidthTiles, 10);
    assert.equal(PERFORMANCE_SERPENTINE_MAP_DATA.enemySpawnRoutes.length, 2);

    const route = PERFORMANCE_SERPENTINE_MAP_DATA.enemySpawnRoutes[0];
    assert.equal(route.macroCells.length, 116);
    assert.deepEqual(route.macroCells[0], [0, 0]);
    assert.deepEqual(route.macroCells.at(-1), [16, 11]);
    assert.deepEqual(PERFORMANCE_SERPENTINE_MAP_DATA.coreMacroCell, [16, 11]);
    assert.deepEqual(PERFORMANCE_SERPENTINE_MAP_DATA.towerSpawnMacroCell,
        [16, 10]);
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
    assert.equal(tileMap.rows, 170);
    assert.equal(tileMap.columns, 120);
    assert.equal(tileMap.getSpawnRoutes().length, 2);
    assert.equal(tileMap.getSpawnRoutes()[0].waypoints.length, 116);
    assert.equal(tileMap.getSpawnRoutes()[1].waypoints.length, 116);
    assert.ok(tileMap.getRouteGraph());
    assert.equal(tileMap.getRouteGraph().routeSets.length, 1);
    assert.equal(tileMap.getRouteGraph().closures.length, 2);
});

test('성능 wave는 10종 census 뒤 C/T/A를 1 tick 간격으로 총 10,000개 예약한다', () => {
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
        BASIC_OCTA_ENEMY_DATA.id,
        BASIC_JORANG_ENEMY_DATA.id,
        BASIC_RING_ENEMY_DATA.id,
        BASIC_CORK_ENEMY_DATA.id
    ]);
    assert.deepEqual({ ...PERFORMANCE_SERPENTINE_SESSION }, {
        towerMaxHp: 20_000_000,
        coreMaxIntegrity: 20_000_000
    });

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
        [BASIC_CIRCLE_ENEMY_DATA.id]: 3_331,
        [BASIC_TRIANGLE_ENEMY_DATA.id]: 3_331,
        [BASIC_ARROW_ENEMY_DATA.id]: 3_331,
        [BASIC_RHOM_ENEMY_DATA.id]: 1,
        [BASIC_PENTA_ENEMY_DATA.id]: 1,
        [BASIC_HEXA_ENEMY_DATA.id]: 1,
        [BASIC_OCTA_ENEMY_DATA.id]: 1,
        [BASIC_JORANG_ENEMY_DATA.id]: 1,
        [BASIC_RING_ENEMY_DATA.id]: 1,
        [BASIC_CORK_ENEMY_DATA.id]: 1
    });
    director.destroy();
});

test('성능 map Arrow도 production normalized easeOutExpo λ=10 fixed curve를 사용한다', () => {
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /const ENEMY_CHARGE_EXPO_OUT_LAMBDA: f32 = 10\.0;/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn normalized_bounded_expo_out\(progress: f32\) -> f32/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn enemy_charge_expo_out_velocity\(/u
    );
});
