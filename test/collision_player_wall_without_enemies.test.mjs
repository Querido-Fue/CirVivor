import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// VM test loader가 공유 의존성을 동시에 링크하지 않도록 공통 graph를 아래에서 위로 평가합니다.
for (const modulePath of [
    'physics/collision_math_constants.js',
    'physics/collision_body_layout.js',
    'physics/collision_grid_layout.js',
    'physics/_collision_detector.js',
    'util/number_util.js',
    'physics/_collision_resolve_tuning.js',
    'physics/_collision_projectile_effect.js',
    'physics/collision_broad_phase_filter.js',
    'physics/collision_manifold_writer.js',
    'physics/collision_body_detector.js',
    'physics/collision_soa_layout.js',
    'physics/collision_broadphase_buffer.js',
    'physics/collision_scratch_objects.js',
    'physics/collision_body_pool.js',
    'physics/collision_candidate_admission.js',
    'physics/collision_candidate_pair_buffer.js',
    'physics/collision_candidate_density.js',
    'physics/collision_body_translation.js',
    'physics/collision_pair_resolver.js',
    'physics/collision_enemy_circle_pair_soa.js',
    'physics/collision_enemy_pair_budget.js',
    'physics/_collision_rules.js',
    'physics/collision_pair_rule_guard.js',
    'physics/collision_enemy_sleep_state.js',
    'physics/collision_candidate_pair_processor.js',
    'physics/collision_enemy_body_cache.js',
    'simulation/simulation_runtime.js',
    'physics/_collision_enemy_geometry.js',
    'physics/collision_enemy_body_builder.js',
    'physics/collision_grid_bucket_pool.js',
    'physics/collision_grid_cell_size.js',
    'physics/collision_grid_query_buffer.js',
    'physics/collision_player_body_builder.js',
    'physics/collision_projectile_sweep_body.js',
    'physics/collision_wall_body_builder.js',
    'physics/collision_frame_stats.js',
    'physics/collision_profile_recorder.js'
]) {
    await loadGameModule(modulePath);
}

const { CollisionHandler } = await loadGameModule('physics/_collision_handler.js');

const collisionHandler = new CollisionHandler();
const player = {
    id: 1,
    active: true,
    radius: 5,
    weight: 1,
    position: { x: 5, y: 0 },
    prevPosition: { x: 5, y: 0 }
};
collisionHandler.setWalls([{ x: 8, y: -10, w: 10, h: 20 }]);
collisionHandler.resetFrameStats();

const resolvedCount = collisionHandler.resolveEnemyCollisions([], {
    delta: 1 / 60,
    players: [player]
});

assert.ok(resolvedCount > 0, '적이 없어도 player-wall pair를 해소해야 합니다.');
assert.ok(player.position.x < 5, '겹친 플레이어 위치가 벽 바깥 방향으로 이동해야 합니다.');
assert.equal(player.position.y, 0);
assert.deepEqual(player.prevPosition, { x: 5, y: 0 });

console.log('collision player-wall without enemies contract: ok');
