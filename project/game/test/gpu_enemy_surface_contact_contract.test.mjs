import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    THE_CORE_DATA
} = await loadGameModule('data/object/core/the_core_data.js');
const {
    THE_TOWER_DATA
} = await loadGameModule('data/object/tower/the_tower_data.js');
const {
    PERFORMANCE_SERPENTINE_MAP_DATA
} = await loadGameModule('data/scene/game/performance_serpentine_map_data.js');
const {
    createGpuCoreProxySpawnIntent
} = await loadGameModule(
    'ingame/object/core/gpu_core_proxy_spawn_adapter.js'
);
const {
    createGpuTowerSpawnIntent
} = await loadGameModule(
    'ingame/object/tower/gpu_tower_spawn_adapter.js'
);
const {
    createRouteFlowFieldAtlas
} = await loadGameModule('ingame/navigation/route_flow_field_atlas.js');
const {
    GPU_COLLISION_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const { TileMap } = await loadGameModule('ingame/map/tile_map.js');

test('Core impact는 반지름 1.01 가상원 접촉 전에 flow가 멈추지 않는다', () => {
    assert.equal(THE_CORE_DATA.ENEMY_IMPACT_RADIUS_SCALE, 1.01);
    assert.equal(
        THE_CORE_DATA.ENEMY_IMPACT_RADIUS_TILES,
        THE_CORE_DATA.RADIUS_TILES
            * THE_CORE_DATA.ENEMY_IMPACT_RADIUS_SCALE
    );

    const core = createGpuCoreProxySpawnIntent({
        position: { x: 20, y: 12 }
    });
    assert.equal(core.radius, THE_CORE_DATA.ENEMY_IMPACT_RADIUS_TILES);
    assert.equal(core.collisionMask, 0);

    const atlas = createRouteFlowFieldAtlas(
        new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA)
    );
    const route = atlas.routes[0];
    const finalStage = atlas.stages[
        route.firstFieldIndex + route.fieldCount - 1
    ];
    assert.equal(
        finalStage.transitionRadius,
        THE_CORE_DATA.ENEMY_IMPACT_RADIUS_TILES
    );
});

test('Tower 물리 반지름은 유지하고 피해 접촉 반경에만 1% skin을 적용한다', () => {
    assert.equal(THE_TOWER_DATA.DAMAGEABLE_CONTACT_RADIUS_SCALE, 1.01);
    const tower = createGpuTowerSpawnIntent({
        position: { x: 8, y: 5 }
    });
    assert.equal(tower.radius, THE_TOWER_DATA.RADIUS_TILES);

    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /const PLAYER_DAMAGEABLE_INTERACTION_RADIUS_SCALE: f32 = 1\.01;/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn body_interaction_radius\(body: GridBody\) -> f32 \{[\s\S]*?BODY_LAYER_PLAYER_DAMAGEABLE[\s\S]*?body\.radius \* PLAYER_DAMAGEABLE_INTERACTION_RADIUS_SCALE;/u
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /let minimum_distance = body_interaction_radius\(self_body\)[\s\S]*?\+ body_interaction_radius\(other_body\);/u
    );
});
