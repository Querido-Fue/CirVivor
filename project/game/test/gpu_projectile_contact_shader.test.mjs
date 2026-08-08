import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const shaders = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const compute = shaders.GPU_COLLISION_COMPUTE_WGSL;
const indirect = shaders.GPU_COLLISION_INDIRECT_WGSL;
const render = shaders.GPU_COLLISION_RENDER_WGSL;

const FIXED_DELTA_F32 = Math.fround(1 / 60);
const DEATH_EVENT_FLAG_HEALTH = 1 << 0;
const DEATH_EVENT_FLAG_LIFETIME = 1 << 1;

function updateLifetimeF32(value) {
    const lifetime = Math.fround(value);
    if (lifetime < 0) {
        return lifetime;
    }
    return Math.fround(Math.max(Math.fround(lifetime - FIXED_DELTA_F32), 0));
}

function firstZeroFixedUpdate(value, maximumUpdates = 256) {
    let lifetime = Math.fround(value);
    for (let update = 1; update <= maximumUpdates; update++) {
        lifetime = updateLifetimeF32(lifetime);
        if (lifetime === 0) {
            return update;
        }
    }
    return null;
}

function markDeadReference({ entityId, incarnation, bodyId, health, lifetime, alive }) {
    let reasonFlags = 0;
    if (health <= 0) {
        reasonFlags |= DEATH_EVENT_FLAG_HEALTH;
    }
    if (lifetime === 0) {
        reasonFlags |= DEATH_EVENT_FLAG_LIFETIME;
    }
    if (reasonFlags === 0 || !alive) {
        return [];
    }
    return [{ entityId, incarnation, bodyId, reasonFlags }];
}

function applyTargetDamageReference(healthBefore, amount) {
    if (amount <= 0) {
        return { applied: 0, healthAfter: healthBefore, targetDied: false };
    }
    if (healthBefore <= 0) {
        return { applied: 0, healthAfter: healthBefore, targetDied: true };
    }
    const applied = Math.min(healthBefore, amount);
    const healthAfter = healthBefore - applied;
    return { applied, healthAfter, targetDied: healthAfter === 0 };
}

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

// ABI v3는 동일 stride 안에서 physical/interaction/gameplay/flags를 분리합니다.
assert.match(compute, /const BODY_ABI_VERSION: u32 = 3u;/);
assert.match(compute, /struct BodyCounts \{[\s\S]*?abi_version: u32,/);
assert.match(compute, /struct BodyPhysics \{[\s\S]*?physical_meta: u32,[\s\S]*?interaction_meta: u32,/);
assert.match(compute, /struct BodySimulation \{[\s\S]*?lifetime: f32,[\s\S]*?health: atomic<i32>,[\s\S]*?gameplay_meta: u32,[\s\S]*?flags: atomic<u32>,[\s\S]*?incarnation: u32,/);
assert.match(render, /struct BodySimulation \{[\s\S]*?health: i32,[\s\S]*?gameplay_meta: u32,[\s\S]*?flags: u32,/);
assert.match(compute, /struct GridBody \{[\s\S]*?physical_meta: u32,[\s\S]*?flags: u32,[\s\S]*?interaction_meta: u32,/);
assert.match(compute, /@group\(0\) @binding\(4\) var<storage, read> contact_handlers: ContactHandlerBuffer;/);
assert.match(compute, /struct ContactHandler \{\s*damage_self: f32,\s*damage_other: f32,\s*damage_falloff: f32,\s*fire_timer: f32,\s*flags: u32,\s*chaining: i32,\s*damage_report_id: i32,\s*slow_timer: f32,/);
assert.match(compute, /let damage_self = max\(i32\(handler\.damage_self \* 100\.0\), 0\);/);
assert.match(compute, /let damage_other = max\(i32\(damage_other_value \* 100\.0\), 0\);/);
assert.match(compute, /const GAMEPLAY_TEAM_NEUTRAL: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_TEAM_PLAYER: u32 = 1u;/);
assert.match(compute, /const GAMEPLAY_TEAM_HOSTILE: u32 = 2u;/);
assert.match(compute, /const GAMEPLAY_DAMAGE_POLICY_DEFAULT_TEAM_MATRIX: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_META_TEAM_SHIFT: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_META_TEAM_MASK: u32 = 255u;/);
assert.match(compute, /const GAMEPLAY_META_DAMAGE_POLICY_SHIFT: u32 = 8u;/);
assert.match(compute, /const GAMEPLAY_META_DAMAGE_POLICY_MASK: u32 = 255u;/);
assert.match(compute, /const GAMEPLAY_META_RESERVED_MASK: u32 = 4294901760u;/);
assert.match(compute, /fn gameplay_team_id\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_TEAM_MASK/);
assert.match(compute, /fn gameplay_damage_policy_id\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_DAMAGE_POLICY_MASK/);
assert.match(compute, /fn gameplay_meta_is_valid\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_RESERVED_MASK[\s\S]*?GAMEPLAY_DAMAGE_POLICY_DEFAULT_TEAM_MATRIX/);
assert.match(compute, /fn gameplay_damage_is_allowed\(source_meta: u32, target_meta: u32\)[\s\S]*?GAMEPLAY_TEAM_PLAYER[\s\S]*?GAMEPLAY_TEAM_HOSTILE/);

// Team은 기존 simulation word에서 decode하므로 storage binding을 하나도 늘리지 않습니다.
const storageBindingBlock = compute.slice(
    compute.indexOf('@group(0) @binding(0)'),
    compute.indexOf('fn abi_is_current()')
);
const storageBindings = Array.from(storageBindingBlock.matchAll(
    /@group\((\d+)\) @binding\((\d+)\) var<storage,[^>]+> (\w+):/g
), ([, group, binding, name]) => `${group}:${binding}:${name}`);
assert.deepEqual(storageBindings, [
    '0:0:counts', '0:1:physics', '0:2:simulations', '0:3:temporaries',
    '0:4:contact_handlers', '0:5:body_control_states',
    '0:6:body_control_program', '0:7:spawn_program',
    '0:8:tracked_pose_config', '0:9:tracked_pose_output',
    '1:0:grid_counts', '1:1:grid_bodies', '1:2:sdf_values',
    '1:3:grid_overflow', '3:0:contact_state', '3:1:contacts',
    '3:2:applied_events', '3:3:death_events'
]);
assert.equal(storageBindings.length, 18);
assert.doesNotMatch(storageBindingBlock, /gameplay|team|damage_policy/i);

// SpawnProgram v3는 80-byte record에서 exact target identity와 aim payload를 고정합니다.
assert.match(compute, /const SPAWN_PROGRAM_ABI_VERSION: u32 = 3u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_VELOCITY: u32 = 1u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT: u32 = 2u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY: u32 = 3u;/);
assert.match(compute, /const SPAWN_PROGRAM_RESULT_TARGET_INVALID: u32 = 4u;/);
assert.match(
    compute,
    /struct SpawnProgramRecord \{\s*destination_slot: u32,\s*destination_entity_id: u32,\s*destination_incarnation: u32,\s*source_slot: u32,\s*source_entity_id: u32,\s*source_incarnation: u32,\s*target_slot: u32,\s*target_entity_id: u32,\s*target_incarnation: u32,\s*mode_flags: u32,\s*result: u32,\s*source_tick: u32,\s*position_offset: vec2f,\s*target_offset: vec2f,\s*vector: vec2f,\s*scalar: f32,\s*reserved_0: u32,\s*\}/
);
assert.match(
    compute,
    /let supported_mode = program\.mode_flags[\s\S]*?SOURCE_RELATIVE_VELOCITY[\s\S]*?SOURCE_RELATIVE_AIM_POINT[\s\S]*?SOURCE_RELATIVE_TARGET_ENTITY;/
);
assert.match(
    compute,
    /program\.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT[\s\S]*?!\(program\.scalar > 0\.0\)/
);
assert.match(
    compute,
    /let target_mode = program\.mode_flags[\s\S]*?SOURCE_RELATIVE_TARGET_ENTITY;[\s\S]*?program\.target_slot == INVALID_IDENTITY_COMPONENT[\s\S]*?all\(program\.target_offset == vec2f\(0\.0\)\)[\s\S]*?program\.target_slot < body_capacity[\s\S]*?all\(program\.vector == vec2f\(0\.0\)\)/
);
assert.match(
    compute,
    /let body_capacity = arrayLength\(&simulations\.values\);[\s\S]*?program\.destination_slot >= counts\.body_count[\s\S]*?program\.source_slot >= body_capacity/
);

// Aim cardinal는 authoritative tick-start source position에서 world aim을 빼고 정규화합니다.
// 동일 지점은 source velocity, 그것도 0이면 +X로 결정적 fallback합니다.
const aimResolveStart = compute.lastIndexOf(
    'if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT)'
);
assert.ok(aimResolveStart >= 0);
const aimResolveBlock = compute.slice(aimResolveStart, aimResolveStart + 900);
assert.match(
    compute,
    /let destination_position = source_physics\.position \+ program\.position_offset;/
);
assert.match(
    aimResolveBlock,
    /var launch_direction = program\.vector - source_physics\.position;/
);
assert.match(
    aimResolveBlock,
    /launch_direction = source_physics\.velocity;[\s\S]*?launch_direction = vec2f\(1\.0, 0\.0\);/
);
assert.match(
    aimResolveBlock,
    /launch_direction \*= inverseSqrt\(launch_direction_length_squared\);/
);
assert.match(
    aimResolveBlock,
    /destination_velocity = launch_direction \* program\.scalar;/
);
assert.doesNotMatch(aimResolveBlock, /tracked|readback/);

// Target entity는 source/target의 tick-start physics만 읽고 targetOffset을 aim에만 적용합니다.
const targetResolveStart = compute.lastIndexOf(
    '== SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY) {'
);
assert.ok(targetResolveStart >= 0);
const targetResolveBlock = compute.slice(targetResolveStart, targetResolveStart + 1250);
assert.match(
    targetResolveBlock,
    /let target_physics = physics\.values\[program\.target_slot\];/
);
assert.match(
    targetResolveBlock,
    /\(target_physics\.position \+ program\.target_offset\)\s*- source_physics\.position;/
);
assert.match(
    targetResolveBlock,
    /launch_direction = source_physics\.velocity;[\s\S]*?launch_direction = vec2f\(1\.0, 0\.0\);/
);
assert.match(
    targetResolveBlock,
    /destination_velocity = launch_direction \* program\.scalar;/
);
assert.doesNotMatch(targetResolveBlock, /team|gameplay|target_policy|tracked|readback/i);

const spawnResolveStart = compute.indexOf('fn resolve_source_relative_spawns(');
const spawnResolveEnd = compute.indexOf('fn prepare_bodies(', spawnResolveStart);
const spawnResolveBlock = compute.slice(spawnResolveStart, spawnResolveEnd);
const destinationInvalidIndex = spawnResolveBlock.indexOf(
    'SPAWN_PROGRAM_RESULT_DESTINATION_INVALID'
);
const sourceInvalidIndex = spawnResolveBlock.indexOf(
    'SPAWN_PROGRAM_RESULT_SOURCE_INVALID'
);
const targetInvalidIndex = spawnResolveBlock.indexOf(
    'SPAWN_PROGRAM_RESULT_TARGET_INVALID'
);
assert.ok(
    destinationInvalidIndex >= 0
        && sourceInvalidIndex > destinationInvalidIndex
        && targetInvalidIndex > sourceInvalidIndex
);
const destinationWriteIndex = spawnResolveBlock.indexOf(
    'physics.values[program.destination_slot].position = destination_position;'
);
const aliveActivationIndex = spawnResolveBlock.indexOf(
    '&simulations.values[program.destination_slot].flags'
);
const resolvedResultIndex = spawnResolveBlock.indexOf(
    'SPAWN_PROGRAM_RESULT_RESOLVED',
    aliveActivationIndex
);
assert.ok(
    destinationWriteIndex >= 0
        && aliveActivationIndex > destinationWriteIndex
        && resolvedResultIndex > aliveActivationIndex
);

// 새 contact/event bind group과 고정 stride 레코드를 정적으로 잠급니다.
assert.match(compute, /struct ContactState \{[\s\S]*?contact_count: atomic<u32>,[\s\S]*?death_overflow: atomic<u32>,[\s\S]*?abi_status: atomic<u32>,[\s\S]*?event_encoding_version: atomic<u32>,/);
assert.match(compute, /struct Contact \{\s*self_body_id: u32,\s*self_incarnation: u32,\s*other_body_id: i32,\s*other_incarnation: u32,\s*world_position: vec2f,\s*normal: vec2f,/);
assert.match(compute, /struct AppliedEvent \{\s*subject_entity_id: u32,\s*subject_incarnation: u32,\s*other_entity_id: u32,\s*other_incarnation: u32,\s*value_fixed_point: i32,\s*event_meta: u32,\s*world_position: vec2f,/);
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

// Interaction pair는 reciprocal이고 enter policy만 previous-overlap을 억제합니다.
assert.match(compute, /self_mask & other_layer/);
assert.match(compute, /other_mask & self_layer/);
const reciprocalCapabilityGate = compute.indexOf(
    'if ((self_mask & other_layer) == 0u'
);
const reciprocalCapabilityAppend = compute.indexOf(
    'append_contact(contact);',
    reciprocalCapabilityGate
);
assert.ok(
    reciprocalCapabilityGate >= 0
        && reciprocalCapabilityAppend > reciprocalCapabilityGate
);
assert.match(
    compute.slice(reciprocalCapabilityGate, reciprocalCapabilityAppend),
    /self_mask & other_layer[\s\S]*?other_mask & self_layer[\s\S]*?return selection;/
);
assert.match(compute, /if \(suppress_previous_overlap\)[\s\S]*?previous_delta[\s\S]*?minimum_distance_squared/);
assert.match(compute, /CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY/);
assert.match(compute, /CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS/);
assert.match(compute, /APPLIED_EVENT_TYPE_INTERACTION_CONTINUOUS/);
assert.match(compute, /fn interaction_policy_event_type\(flags: u32\)[\s\S]*?INTERACTION_CONTINUOUS[\s\S]*?INTERACTION_ENTER/);
assert.match(compute, /CONTACT_HANDLER_FLAG_CLOSEST_ONLY/);
assert.match(compute, /if \(closest_only && selection\.found != 0u\)/);

// big/small 분류와 큰 센서의 covered-cell scan은 최대 상호작용 반경을 사용합니다.
assert.match(compute, /return radius \* 2\.0\s*<= min\(params\.grid_cell_size\.x, params\.grid_cell_size\.y\)/);
assert.match(compute, /let maximum_small_radius = 0\.5[\s\S]*?body\.radius \+ maximum_small_radius/);
assert.match(compute, /let interaction_radius = self_physics\.radius\s*\+ max\(params\.maximum_body_radius, 0\.0\);/);
assert.match(compute, /scan_canonical_big_contact_bucket/);
assert.match(compute, /deterministic_separation_normal/);

// contact가 하나라도 overflow되면 handler 전체가 아무 피해도 적용하지 않습니다.
assert.match(compute, /if \(atomicLoad\(&contact_state\.contact_overflow\) != 0u\) \{\s*return;/);
assert.match(compute, /contact_index >= params\.max_contacts[\s\S]*?contact_state\.contact_overflow/);

// damage_other=0의 기존 interaction 처리 뒤, team gate는 budget reservation보다 먼저 실행합니다.
const zeroDamageBranch = compute.indexOf('if (damage_other <= 0)');
const gameplayDamageGate = compute.indexOf('if (!gameplay_damage_is_allowed(', zeroDamageBranch);
const reserveCall = compute.indexOf('let self_budget_reserved = reserve_self_hit_budget');
const targetDamageCall = compute.indexOf('let damage = apply_target_damage');
assert.ok(
    reciprocalCapabilityGate >= 0
        && zeroDamageBranch > reciprocalCapabilityGate
        && gameplayDamageGate > zeroDamageBranch
        && reserveCall > gameplayDamageGate
        && targetDamageCall > reserveCall
);
const gameplayDamageGateBlock = compute.slice(gameplayDamageGate, reserveCall);
assert.match(
    gameplayDamageGateBlock,
    /simulations\.values\[self_body_id\]\.gameplay_meta,[\s\S]*?simulations\.values\[other_body_id\]\.gameplay_meta/
);
assert.match(
    gameplayDamageGateBlock,
    /append_applied_event\(AppliedEvent\([\s\S]*?\n\s*0,[\s\S]*?policy_event_type \| policy_event_flag,[\s\S]*?\n\s*contact\.world_position[\s\S]*?\)\);[\s\S]*?return;/
);
assert.doesNotMatch(
    gameplayDamageGateBlock,
    /reserve_self_hit_budget|apply_target_damage|APPLIED_EVENT_TYPE_DAMAGE_APPLIED|append_death_event/
);
assert.match(compute, /atomicCompareExchangeWeak\(\s*&simulations\.values\[body_id\]\.health/);
assert.match(compute, /if \(health_before < amount\) \{\s*return false;/);
assert.match(compute, /if \(damage\.applied <= 0\)[\s\S]*?atomicAdd\(&simulations\.values\[self_body_id\]\.health, damage_self\);/);

// Target damage는 overkill에서도 음수 HP를 쓰지 않고 canonical zero만 death로 판정합니다.
const targetDamageStart = compute.indexOf('fn apply_target_damage(');
const targetDamageEnd = compute.indexOf('fn clear_alive_once(', targetDamageStart);
assert.ok(targetDamageStart >= 0 && targetDamageEnd > targetDamageStart);
const targetDamageBlock = compute.slice(targetDamageStart, targetDamageEnd);
assert.match(
    targetDamageBlock,
    /let applied_amount = min\(health_before, amount\);[\s\S]*?let health_after = health_before - applied_amount;/
);
assert.match(
    targetDamageBlock,
    /atomicCompareExchangeWeak\([\s\S]*?health_before,[\s\S]*?health_after[\s\S]*?select\(0u, 1u, health_after == 0\)/
);
assert.doesNotMatch(targetDamageBlock, /health_before\s*-\s*amount/);
assert.deepEqual(applyTargetDamageReference(30, 100), {
    applied: 30,
    healthAfter: 0,
    targetDied: true
});
assert.deepEqual(applyTargetDamageReference(30, 30), {
    applied: 30,
    healthAfter: 0,
    targetDied: true
});

// terrain kill도 applied event에서 끝나지 않고 registry 회수용 death를 반드시 남깁니다.
assert.match(compute, /APPLIED_EVENT_TYPE_INTERACTION_ENTER/);
assert.match(compute, /APPLIED_EVENT_TYPE_DAMAGE_APPLIED[\s\S]*?policy_event_flag[\s\S]*?target_died_flag/);
assert.match(compute, /APPLIED_EVENT_FLAG_TERRAIN_CONTACT[\s\S]*?APPLIED_EVENT_FLAG_TERRAIN_KILL[\s\S]*?append_death_event\(self_body_id, DEATH_EVENT_FLAG_HEALTH\);/);

// Physical pair는 sensor 여부와 무관하게 reciprocal physical mask만 사용합니다.
assert.match(compute, /body_collision_mask\(self_body\.physical_meta\)[\s\S]*?body_layer\(other_body\.physical_meta\)/);
assert.match(compute, /body_collision_mask\(other_body\.physical_meta\)[\s\S]*?body_layer\(self_body\.physical_meta\)/);
assert.doesNotMatch(compute, /body_sensor_mask/);

// 같은 iteration의 body-body delta까지 terrain constraint가 평가해 마지막 Jacobi 침투를 막습니다.
assert.match(
    compute,
    /let candidate = predicted \+ temporaries\.values\[body_id\]\.position_delta;[\s\S]*?sample_world_sdf\(candidate\)/
);

// finite lifetime만 prepare에서 0으로 clamp하고 mark_dead는 canonical exact zero만 판정합니다.
assert.match(compute, /if \(lifetime >= 0\.0\) \{\s*simulations\.values\[body_id\]\.lifetime = max\(lifetime - params\.dt, 0\.0\);/);
assert.match(compute, /if \(lifetime == 0\.0\)/);
assert.doesNotMatch(compute, /lifetime\s*(?:<=|<)\s*0\.0/);
assert.match(compute, /atomicAnd\(\s*&simulations\.values\[body_id\]\.flags/);
assert.match(compute, /append_death_event\(body_id, reason_flags\);/);
assert.match(compute, /event_index >= params\.max_events[\s\S]*?event_overflow/);
assert.match(compute, /death_index >= params\.max_death_events[\s\S]*?death_overflow/);

// WGSL f32와 같은 매 연산 f32 반올림으로 sentinel/경계/2초 expiry tick을 잠급니다.
assert.equal(updateLifetimeF32(-1), -1);
assert.equal(firstZeroFixedUpdate(-1), null);
assert.equal(updateLifetimeF32(0), 0);
assert.equal(firstZeroFixedUpdate(0), 1);
assert.equal(updateLifetimeF32(Math.fround(FIXED_DELTA_F32 * 0.5)), 0);
assert.equal(firstZeroFixedUpdate(Math.fround(FIXED_DELTA_F32 * 0.5)), 1);
assert.equal(firstZeroFixedUpdate(2), 121);
let twoSecondLifetime = Math.fround(2);
for (let update = 0; update < 120; update++) {
    twoSecondLifetime = updateLifetimeF32(twoSecondLifetime);
}
assert.ok(twoSecondLifetime > 0);
assert.equal(updateLifetimeF32(twoSecondLifetime), 0);

// health와 lifetime이 같은 tick에 만료돼도 한 identity/event에 두 reason bit를 합칩니다.
const simultaneousDeathEvents = markDeadReference({
    entityId: 101,
    incarnation: 7,
    bodyId: 3,
    health: 0,
    lifetime: 0,
    alive: true
});
assert.deepEqual(simultaneousDeathEvents, [{
    entityId: 101,
    incarnation: 7,
    bodyId: 3,
    reasonFlags: DEATH_EVENT_FLAG_HEALTH | DEATH_EVENT_FLAG_LIFETIME
}]);
const markDeadStart = compute.indexOf('fn mark_dead(');
const markDeadEnd = compute.indexOf('fn clear_position_deltas(', markDeadStart);
assert.ok(markDeadStart >= 0 && markDeadEnd > markDeadStart);
const markDeadBlock = compute.slice(markDeadStart, markDeadEnd);
assert.match(markDeadBlock, /reason_flags \|= DEATH_EVENT_FLAG_HEALTH;[\s\S]*?reason_flags \|= DEATH_EVENT_FLAG_LIFETIME;/);
assert.match(markDeadBlock, /if \(reason_flags == 0u \|\| !clear_alive_once\(body_id\)\) \{\s*return;/);
assert.doesNotMatch(markDeadBlock, /epsilon|abs\s*\(/i);
assert.equal((markDeadBlock.match(/append_death_event\(body_id, reason_flags\);/g) ?? []).length, 1);

// mark_dead 직후 렌더링되는 tombstone은 simulation binding으로 즉시 숨깁니다.
assert.match(render, /@group\(0\) @binding\(4\) var<storage, read> simulations: SimulationBuffer;/);
assert.match(render, /counts\.abi_version != BODY_ABI_VERSION/);
assert.match(render, /if \(\(simulation_flags & 1u\) == 0u\)[\s\S]*?output\.color = vec4f\(0\.0\);[\s\S]*?return output;/);
assert.match(indirect, /counts\.abi_version != BODY_ABI_VERSION[\s\S]*?draw_args\.instance_count = 0u/);

// 모든 compute entrypoint는 mismatch에서 fail closed하고 clear_contact_state는 status를 남깁니다.
assert.ok((compute.match(/if \(!abi_is_current\(\)\)/g) ?? []).length >= 13);
assert.match(compute, /contact_state\.abi_status[\s\S]*?CONTACT_ABI_STATUS_MISMATCH/);

console.log('gpu projectile contact shader contract: ok');
