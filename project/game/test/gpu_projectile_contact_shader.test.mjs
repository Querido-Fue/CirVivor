import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const shaders = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const compute = shaders.GPU_COLLISION_COMPUTE_WGSL;
const render = shaders.GPU_COLLISION_RENDER_WGSL;

for (const entryPoint of [
    'prepare_bodies',
    'clear_grid',
    'build_grid',
    'clear_position_deltas',
    'solve_body_body',
    'solve_body_world',
    'apply_position_deltas',
    'rebuild_velocities',
    'finalize_velocities',
    'clear_contact_state',
    'generate_body_contacts',
    'generate_world_contacts',
    'handle_contacts',
    'mark_dead'
]) {
    assert.match(compute, new RegExp(`fn\\s+${entryPoint}\\b`));
}

// 기존 32바이트 body ABI 위에 atomic health/meta만 적용하며 field offset은 바꾸지 않습니다.
assert.match(compute, /struct BodySimulation \{[\s\S]*?lifetime: f32,[\s\S]*?health: atomic<i32>,[\s\S]*?timer: u32,[\s\S]*?simulation_meta: atomic<u32>,[\s\S]*?incarnation: u32,/);
assert.match(compute, /@group\(0\) @binding\(4\) var<storage, read> contact_handlers: ContactHandlerBuffer;/);
assert.match(compute, /struct ContactHandler \{\s*damage_self: f32,\s*damage_other: f32,\s*damage_falloff: f32,\s*fire_timer: f32,\s*flags: u32,\s*chaining: i32,\s*damage_report_id: i32,\s*slow_timer: f32,/);
assert.match(compute, /let damage_self = max\(i32\(handler\.damage_self \* 100\.0\), 0\);/);
assert.match(compute, /let damage_other = max\(i32\(damage_other_value \* 100\.0\), 0\);/);

// 새 contact/event bind group과 고정 stride 레코드를 정적으로 잠급니다.
assert.match(compute, /struct ContactState \{[\s\S]*?contact_count: atomic<u32>,[\s\S]*?death_overflow: atomic<u32>,[\s\S]*?reserved_1: atomic<u32>,/);
assert.match(compute, /struct Contact \{\s*self_body_id: u32,\s*self_incarnation: u32,\s*other_body_id: i32,\s*other_incarnation: u32,\s*world_position: vec2f,\s*normal: vec2f,/);
assert.match(compute, /struct AppliedEvent \{\s*self_entity_id: u32,\s*self_incarnation: u32,\s*other_entity_id: u32,\s*other_incarnation: u32,\s*damage_applied: i32,\s*flags: u32,\s*world_position: vec2f,/);
assert.match(compute, /struct DeathEvent \{\s*entity_id: u32,\s*incarnation: u32,\s*body_id: u32,\s*reason_flags: u32,/);
assert.match(compute, /@group\(3\) @binding\(0\)[^;]+contact_state: ContactState;/);
assert.match(compute, /@group\(3\) @binding\(1\)[^;]+contacts: ContactBuffer;/);
assert.match(compute, /@group\(3\) @binding\(2\)[^;]+applied_events: AppliedEventBuffer;/);
assert.match(compute, /@group\(3\) @binding\(3\)[^;]+death_events: DeathEventBuffer;/);

// flow stage는 기존 16바이트 stride에서 authored 좌표·반경을 보존합니다.
assert.match(
    compute,
    /struct FlowStage \{\s*goal_position: vec2f,\s*next_field_index: i32,\s*transition_radius: f32,\s*\}/
);
assert.match(compute, /flow_stages: array<FlowStage, 256>,\s*max_contacts: u32,\s*max_events: u32,\s*max_death_events: u32,\s*maximum_body_radius: f32,/);
assert.match(compute, /fn segment_intersects_transition_circle\(/);
assert.match(
    compute,
    /segment_intersects_transition_circle\([\s\S]*?temporaries\.values\[body_id\]\.previous_position,[\s\S]*?current,[\s\S]*?stage\.goal_position,[\s\S]*?stage\.transition_radius/
);
assert.match(compute, /direction = stage\.goal_position - current;/);
assert.doesNotMatch(compute, /goal_cell/);

// 센서/레이어/상대 collision mask, previous-overlap 억제와 closest-only를 보존합니다.
assert.match(compute, /fn body_sensor_mask\(packed_meta: u32\)[\s\S]*?packed_meta >> 16u/);
assert.match(compute, /sensor_mask & other_layer/);
assert.match(compute, /body_collision_mask\(other_body\.physics_meta\) & self_layer/);
assert.match(compute, /previous_delta[\s\S]*?minimum_distance_squared/);
assert.match(compute, /CONTACT_HANDLER_FLAG_CLOSEST_ONLY/);
assert.match(compute, /if \(closest_only && selection\.found != 0u\)/);

// big/small 분류와 큰 센서의 covered-cell scan은 최대 상호작용 반경을 사용합니다.
assert.match(compute, /radius \+ max\(params\.maximum_body_radius, 0\.0\)[\s\S]*?<= min\(params\.grid_cell_size\.x, params\.grid_cell_size\.y\)/);
assert.match(compute, /let interaction_radius = self_physics\.radius\s*\+ max\(params\.maximum_body_radius, 0\.0\);/);
assert.match(compute, /scan_canonical_big_contact_bucket/);
assert.match(compute, /deterministic_separation_normal/);

// contact가 하나라도 overflow되면 handler 전체가 아무 피해도 적용하지 않습니다.
assert.match(compute, /if \(atomicLoad\(&contact_state\.contact_overflow\) != 0u\) \{\s*return;/);
assert.match(compute, /contact_index >= params\.max_contacts[\s\S]*?contact_state\.contact_overflow/);

// self budget을 target damage보다 먼저 CAS 예약하고 죽은 target에는 환불합니다.
const reserveCall = compute.indexOf('let self_budget_reserved = reserve_self_hit_budget');
const targetDamageCall = compute.indexOf('let damage = apply_target_damage');
assert.ok(reserveCall >= 0 && targetDamageCall > reserveCall);
assert.match(compute, /atomicCompareExchangeWeak\(\s*&simulations\.values\[body_id\]\.health/);
assert.match(compute, /if \(health_before < amount\) \{\s*return false;/);
assert.match(compute, /if \(damage\.applied <= 0\)[\s\S]*?atomicAdd\(&simulations\.values\[self_body_id\]\.health, damage_self\);/);

// terrain kill도 applied event에서 끝나지 않고 registry 회수용 death를 반드시 남깁니다.
assert.match(compute, /APPLIED_EVENT_FLAG_TERRAIN_KILL,[\s\S]*?append_death_event\(self_body_id, DEATH_EVENT_FLAG_HEALTH\);/);

// gameplay sensor는 broad phase는 공유하지만 적을 물리적으로 밀지 않습니다.
assert.match(compute, /body_sensor_mask\(self_body\.physics_meta\) != 0u[\s\S]*?body_sensor_mask\(other_body\.physics_meta\) != 0u[\s\S]*?return vec2f\(0\.0\);/);

// 같은 iteration의 body-body delta까지 terrain constraint가 평가해 마지막 Jacobi 침투를 막습니다.
assert.match(
    compute,
    /let candidate = predicted \+ temporaries\.values\[body_id\]\.position_delta;[\s\S]*?sample_world_sdf\(candidate\)/
);

// finite lifetime만 prepare에서 줄이고 mark_dead가 alive를 한 번 내린 뒤 death event를 냅니다.
assert.match(compute, /if \(lifetime >= 0\.0\) \{\s*simulations\.values\[body_id\]\.lifetime = lifetime - params\.dt;/);
assert.match(compute, /if \(lifetime >= 0\.0 && lifetime <= 0\.0\)/);
assert.match(compute, /atomicAnd\(\s*&simulations\.values\[body_id\]\.simulation_meta/);
assert.match(compute, /append_death_event\(body_id, reason_flags\);/);
assert.match(compute, /event_index >= params\.max_events[\s\S]*?event_overflow/);
assert.match(compute, /death_index >= params\.max_death_events[\s\S]*?death_overflow/);

// mark_dead 직후 렌더링되는 tombstone은 simulation binding으로 즉시 숨깁니다.
assert.match(render, /@group\(0\) @binding\(4\) var<storage, read> simulations: SimulationBuffer;/);
assert.match(render, /if \(\(simulation_flags & 1u\) == 0u\)[\s\S]*?output\.color = vec4f\(0\.0\);[\s\S]*?return output;/);

console.log('gpu projectile contact shader contract: ok');
