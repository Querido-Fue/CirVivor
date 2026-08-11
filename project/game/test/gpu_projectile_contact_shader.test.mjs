import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const shaders = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const { THE_TOWER_DATA } = await loadGameModule('data/object/tower/the_tower_data.js');
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

function resolveMaximumDamageWindowBatchReference({
    existingEventCount,
    maxEvents,
    fixedTick,
    towers
}) {
    const preflightEventCount = towers.filter((tower) => (
        tower.health > 0 && tower.candidate !== null
    )).length;
    if (preflightEventCount > maxEvents
        || existingEventCount > maxEvents - preflightEventCount) {
        return {
            protocolFailure: true,
            eventOverflow: 1,
            towers: structuredClone(towers),
            events: []
        };
    }
    const resolvedTowers = structuredClone(towers);
    const events = [];
    for (const tower of resolvedTowers) {
        const candidate = tower.candidate;
        if (!candidate || tower.health <= 0) {
            continue;
        }
        const windowActive = fixedTick < tower.expiresAtFixedTick;
        const requestedDamage = windowActive
            ? Math.max(candidate.finalDamage - tower.peakFinalDamage, 0)
            : candidate.finalDamage;
        if (!windowActive) {
            tower.peakFinalDamage = candidate.finalDamage;
            tower.expiresAtFixedTick = fixedTick + tower.duration;
            tower.peakSourceEntityId = candidate.entityId;
            tower.peakSourceIncarnation = candidate.incarnation;
        } else if (candidate.finalDamage > tower.peakFinalDamage) {
            tower.peakFinalDamage = candidate.finalDamage;
            tower.peakSourceEntityId = candidate.entityId;
            tower.peakSourceIncarnation = candidate.incarnation;
        }
        const damageApplied = Math.min(tower.health, requestedDamage);
        tower.health -= damageApplied;
        events.push({
            towerId: tower.id,
            damageApplied,
            entityId: candidate.entityId,
            incarnation: candidate.incarnation
        });
    }
    return {
        protocolFailure: false,
        eventOverflow: 0,
        towers: resolvedTowers,
        events
    };
}

function decodeMaximumDamageWindowMarkerReference(marker) {
    const magic = 0x7fc00000;
    if ((marker & 0xfffffff0) !== magic) {
        return 0;
    }
    const policy = marker & 0xf;
    return policy === 1 ? 1 : policy === 2 ? 2 : 0;
}

/** XPBD delta_lambda가 같으므로 future impulse/position response도 inverseMass에 비례한다. */
function pairCorrectionMagnitude(inverseMass, otherInverseMass, penetration = 1, alpha = 0) {
    return penetration * inverseMass / (inverseMass + otherInverseMass + alpha);
}

function assertNear(actual, expected, epsilon = 1e-12) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `actual=${actual}, expected=${expected}`
    );
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
    'validate_source_relative_spawns',
    'resolve_source_relative_spawns',
    'validate_selected_target_spawns',
    'resolve_selected_target_spawns',
    'clear_body_control_states',
    'validate_body_control_commands',
    'apply_body_control_commands',
    'apply_controlled_motion',
    'advance_octagon_orbit',
    'advance_enemy_charge',
    'classify_directional_defense_contacts',
    'preflight_core_damage_requests',
    'finalize_core_damage_request_preflight',
    'resolve_core_damage_requests',
    'preflight_maximum_damage_window',
    'finalize_maximum_damage_window_preflight',
    'resolve_maximum_damage_window',
    'mark_dead'
]) {
    assert.match(compute, new RegExp(`fn\\s+${entryPoint}\\b`));
}

// ABI v8은 기존 gameplay/combat/EnemyBehaviorState offset을 유지하고 capture plane을 append합니다.
assert.match(compute, /const BODY_ABI_VERSION: u32 = 8u;/);
assert.match(compute, /struct BodyCounts \{[\s\S]*?abi_version: u32,/);
assert.match(compute, /struct BodyPhysics \{[\s\S]*?physical_meta: u32,[\s\S]*?interaction_meta: u32,/);
assert.match(compute, /struct BodySimulation \{[\s\S]*?lifetime: f32,[\s\S]*?health: atomic<i32>,[\s\S]*?gameplay_meta: u32,[\s\S]*?flags: atomic<u32>,[\s\S]*?incarnation: u32,/);
assert.match(render, /struct BodySimulation \{[\s\S]*?health: i32,[\s\S]*?gameplay_meta: u32,[\s\S]*?flags: u32,/);
assert.match(compute, /struct GridBody \{[\s\S]*?physical_meta: u32,[\s\S]*?flags: u32,[\s\S]*?interaction_meta: u32,/);
assert.match(compute, /@group\(0\) @binding\(4\) var<storage, read> contact_handlers: ContactHandlerBuffer;/);
assert.match(compute, /@group\(0\) @binding\(10\) var<storage, read_write> combat_states: CombatStateBuffer;/);
assert.match(compute, /@group\(0\) @binding\(11\) var<storage, read_write> enemy_behavior_states: EnemyBehaviorStateBuffer;/);
assert.match(compute, /struct ContactHandler \{\s*damage_self: f32,\s*damage_other: f32,\s*damage_falloff: f32,\s*fire_timer: f32,\s*flags: u32,\s*chaining: i32,\s*damage_report_id: i32,\s*slow_timer: f32,/);
assert.match(compute, /let damage_self = max\(i32\(handler\.damage_self \* 100\.0\), 0\);/);
assert.match(compute, /fn resolve_contact_source_modified_damage\(/);
assert.match(compute, /fn resolve_contact_target_mitigation\(/);
assert.match(compute, /fn resolve_final_contact_damage\(/);
assert.match(compute, /let final_damage = resolve_final_contact_damage\(/);
assert.match(compute, /const GAMEPLAY_TEAM_NEUTRAL: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_TEAM_PLAYER: u32 = 1u;/);
assert.match(compute, /const GAMEPLAY_TEAM_HOSTILE: u32 = 2u;/);
assert.match(compute, /const GAMEPLAY_DAMAGE_POLICY_DEFAULT_TEAM_MATRIX: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_DAMAGE_RESOLUTION_POLICY_DIRECT: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW: u32 = 1u;/);
assert.match(compute, /const GAMEPLAY_META_TEAM_SHIFT: u32 = 0u;/);
assert.match(compute, /const GAMEPLAY_META_TEAM_MASK: u32 = 255u;/);
assert.match(compute, /const GAMEPLAY_META_DAMAGE_POLICY_SHIFT: u32 = 8u;/);
assert.match(compute, /const GAMEPLAY_META_DAMAGE_POLICY_MASK: u32 = 255u;/);
assert.match(compute, /const GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_SHIFT: u32 = 16u;/);
assert.match(compute, /const GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_MASK: u32 = 255u;/);
assert.match(compute, /const GAMEPLAY_META_RESERVED_MASK: u32 = 4278190080u;/);
assert.match(compute, /fn gameplay_team_id\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_TEAM_MASK/);
assert.match(compute, /fn gameplay_damage_policy_id\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_DAMAGE_POLICY_MASK/);
assert.match(compute, /fn gameplay_damage_resolution_policy_id\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_DAMAGE_RESOLUTION_POLICY_MASK/);
assert.match(compute, /fn gameplay_meta_is_valid\(gameplay_meta: u32\)[\s\S]*?GAMEPLAY_META_RESERVED_MASK[\s\S]*?GAMEPLAY_DAMAGE_POLICY_DEFAULT_TEAM_MATRIX/);
assert.match(compute, /fn gameplay_damage_is_allowed\(source_meta: u32, target_meta: u32\)[\s\S]*?GAMEPLAY_TEAM_PLAYER[\s\S]*?GAMEPLAY_TEAM_HOSTILE/);

// Team은 기존 simulation word에서 decode하며 Tower gameplay target은 tracked pose와
// 별도 16-byte config binding으로 유지합니다.
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
    '0:8:tracked_pose_config', '0:9:tracked_pose_output', '0:10:combat_states',
    '0:11:enemy_behavior_states', '0:12:effect_summaries',
    '0:13:tower_gameplay_target', '0:14:atomic_transform_states',
    '0:15:atomic_transform_candidates',
    '1:0:grid_counts', '1:1:grid_bodies', '1:2:sdf_values',
    '1:3:grid_overflow', '3:0:contact_state', '3:1:contacts',
    '3:2:applied_events', '3:3:death_events'
]);
assert.equal(storageBindings.length, 24);
assert.doesNotMatch(storageBindingBlock, /gameplay_team|damage_policy/i);
assert.match(
    compute,
    /struct TowerGameplayTargetConfig \{\s*target_slot: u32,\s*entity_id: u32,\s*incarnation: u32,\s*enabled: u32,\s*\}/
);
assert.match(
    compute,
    /fn tower_gameplay_target_is_valid\(\)[\s\S]*?tower_gameplay_target\.target_slot[\s\S]*?tower_gameplay_target\.entity_id[\s\S]*?tower_gameplay_target\.incarnation[\s\S]*?BODY_LAYER_PLAYER_DAMAGEABLE[\s\S]*?GAMEPLAY_TEAM_PLAYER/
);

// BodyControl v2/SpawnProgram v4는 exact priority selection과 96-byte records를 고정합니다.
assert.match(compute, /const BODY_CONTROL_PROGRAM_ABI_VERSION: u32 = 2u;/);
assert.match(compute, /const SPAWN_PROGRAM_ABI_VERSION: u32 = 4u;/);
assert.match(compute, /const BODY_CONTROL_PROGRAM_MODE_PRIORITY_TARGET_IN_RANGE: u32 = 2u;/);
assert.match(compute, /const BODY_CONTROL_RESULT_CORE_SELECTED: u32 = 2u;/);
assert.match(compute, /const BODY_CONTROL_RESULT_TOWER_SELECTED: u32 = 3u;/);
assert.match(compute, /const BODY_CONTROL_RESULT_CORE_INVALID: u32 = 5u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_VELOCITY: u32 = 1u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT: u32 = 2u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY: u32 = 3u;/);
assert.match(compute, /const SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET: u32 = 4u;/);
assert.match(compute, /const SPAWN_PROGRAM_RESULT_TARGET_INVALID: u32 = 4u;/);
assert.match(compute, /const SPAWN_PROGRAM_RESULT_NO_TARGET: u32 = 5u;/);
assert.match(compute, /const SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH: u32 = 6u;/);
assert.match(compute, /const SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID: u32 = 7u;/);
assert.match(
    compute,
    /struct BodyControlRecord \{[\s\S]*?destination_slot: u32,[\s\S]*?selection_sequence: u32,[\s\S]*?selected_target_kind: u32,[\s\S]*?attack_fingerprint: u32,[\s\S]*?selection_policy: u32,[\s\S]*?reserved_0: u32,\s*\}/
);
assert.match(
    compute,
    /struct BodyControlState \{[\s\S]*?move_intent: vec2f,[\s\S]*?source_tick: u32,[\s\S]*?selected_target_kind: u32,[\s\S]*?state_flags: u32,[\s\S]*?attack_range: f32,[\s\S]*?reserved_0: u32,\s*\}/
);
assert.match(
    compute,
    /struct SpawnProgramRecord \{\s*destination_slot: u32,\s*destination_entity_id: u32,\s*destination_incarnation: u32,\s*source_slot: u32,\s*source_entity_id: u32,\s*source_incarnation: u32,\s*target_slot: u32,\s*target_entity_id: u32,\s*target_incarnation: u32,\s*mode_flags: u32,\s*result: u32,\s*source_tick: u32,\s*position_offset: vec2f,\s*target_offset: vec2f,\s*vector: vec2f,\s*scalar: f32,\s*reserved_0: u32,\s*selection_sequence: u32,\s*attack_fingerprint: u32,\s*selected_target_kind: u32,\s*request_flags: u32,\s*\}/
);
assert.match(
    compute,
    /let supported_mode = program\.mode_flags[\s\S]*?SOURCE_RELATIVE_VELOCITY[\s\S]*?SOURCE_RELATIVE_AIM_POINT[\s\S]*?SOURCE_RELATIVE_TARGET_ENTITY[\s\S]*?SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;/
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

const legacyValidateStart = compute.indexOf('fn validate_source_relative_spawns(');
const selectedValidateStart = compute.indexOf('fn validate_selected_target_spawns(');
const legacyResolveStart = compute.indexOf('fn resolve_source_relative_spawns(');
const selectedResolveStart = compute.indexOf('fn resolve_selected_target_spawns(');
const selectedResolveEnd = compute.indexOf(
    'fn tower_gameplay_target_is_valid(',
    selectedResolveStart
);
assert.ok(
    legacyValidateStart >= 0
        && selectedValidateStart > legacyValidateStart
        && legacyResolveStart > selectedValidateStart
        && selectedResolveStart > legacyResolveStart
        && selectedResolveEnd > selectedResolveStart
);
const legacyValidateBlock = compute.slice(legacyValidateStart, selectedValidateStart);
const selectedValidateBlock = compute.slice(selectedValidateStart, legacyResolveStart);
const legacyResolveOnlyBlock = compute.slice(legacyResolveStart, selectedResolveStart);
const selectedResolveBlock = compute.slice(selectedResolveStart, selectedResolveEnd);
assert.match(
    legacyValidateBlock,
    /if \(selected_target_mode\) \{\s*return;\s*\}[\s\S]*?FIXED_PROGRAM_STATUS_RECORD_INVALID/
);
assert.match(
    selectedValidateBlock,
    /!= SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET\) \{\s*return;\s*\}[\s\S]*?FIXED_PROGRAM_STATUS_RECORD_INVALID/
);
assert.match(
    legacyResolveOnlyBlock,
    /== SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET\) \{\s*return;\s*\}[\s\S]*?SPAWN_PROGRAM_RESULT_DESTINATION_INVALID/
);
assert.match(
    selectedResolveBlock,
    /!= SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET\) \{\s*return;\s*\}[\s\S]*?SPAWN_PROGRAM_RESULT_DESTINATION_INVALID/
);
assert.match(
    selectedResolveBlock,
    /control_state\.source_tick != program\.source_tick[\s\S]*?control_state\.selection_sequence != program\.selection_sequence[\s\S]*?control_state\.attack_fingerprint != program\.attack_fingerprint/
);
assert.match(
    selectedResolveBlock,
    /BODY_LAYER_TERRAIN \| selected_interaction_layer[\s\S]*?target_interaction_layer_mask = selected_interaction_layer/
);
assert.match(
    selectedResolveBlock,
    /target_physics\.position \+ program\.target_offset[\s\S]*?- destination_position/
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
assert.match(compute, /struct CombatState \{[\s\S]*?target_interaction_layer_mask: u32,[\s\S]*?maximum_damage_window_duration_fixed_ticks: u32,[\s\S]*?peak_final_damage_fixed_point: atomic<i32>,[\s\S]*?expires_at_fixed_tick: atomic<u32>,[\s\S]*?peak_source_entity_id: atomic<u32>,[\s\S]*?peak_source_incarnation: atomic<u32>,/);
assert.match(compute, /struct ContactState \{[\s\S]*?contact_count: atomic<u32>,[\s\S]*?death_overflow: atomic<u32>,[\s\S]*?abi_status: atomic<u32>,[\s\S]*?event_encoding_version: atomic<u32>,[\s\S]*?maximum_damage_window_event_count: atomic<u32>,[\s\S]*?maximum_damage_window_protocol_status: atomic<u32>,[\s\S]*?core_damage_request_event_count: atomic<u32>,[\s\S]*?core_damage_request_protocol_status: atomic<u32>,/);
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
assert.match(compute, /flow_stages: array<FlowStage, 256>,\s*max_contacts: u32,\s*max_events: u32,\s*max_death_events: u32,\s*maximum_body_radius: f32,\s*fixed_tick: u32,/);
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

// zero authored damage와 target-layer/team/stale gate는 budget reservation보다
// 먼저이고, directional mitigation/fully-absorbed event는 valid budget 뒤입니다.
const handleContactsStartForOrdering = compute.indexOf('fn handle_contacts(');
const zeroSourceDamageBranch = compute.indexOf(
    'if (source_modified_damage <= 0)',
    handleContactsStartForOrdering
);
const targetLayerGate = compute.indexOf(
    'if (!contact_handler_accepts_target(',
    zeroSourceDamageBranch
);
const gameplayDamageGate = compute.indexOf('if (!gameplay_damage_is_allowed(', targetLayerGate);
const reserveCall = compute.indexOf(
    'let self_budget_reserved = reserve_self_hit_budget',
    gameplayDamageGate
);
const targetMitigationCall = compute.indexOf(
    'let final_damage = resolve_contact_target_mitigation',
    reserveCall
);
const zeroDamageBranch = compute.indexOf(
    'if (final_damage <= 0)',
    targetMitigationCall
);
const targetDamageCall = compute.indexOf('let damage = apply_target_damage', reserveCall);
assert.ok(
    reciprocalCapabilityGate >= 0
        && zeroSourceDamageBranch > reciprocalCapabilityGate
        && targetLayerGate > zeroSourceDamageBranch
        && gameplayDamageGate > targetLayerGate
        && reserveCall > gameplayDamageGate
        && targetMitigationCall > reserveCall
        && zeroDamageBranch > targetMitigationCall
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
assert.match(
    compute,
    /fn contact_handler_accepts_target\(self_body_id: u32, other_body_id: u32\)[\s\S]*?body_interaction_layer[\s\S]*?combat_states\.values\[self_body_id\][\s\S]*?target_interaction_layer_mask/
);
assert.match(compute, /atomicCompareExchangeWeak\(\s*&simulations\.values\[body_id\]\.health/);
assert.match(compute, /if \(health_before < amount\) \{\s*return false;/);
assert.match(compute, /if \(damage\.applied <= 0\)[\s\S]*?atomicAdd\(&simulations\.values\[self_body_id\]\.health, damage_self\);/);

// DIRECT target은 기존 per-hit apply를 유지하고 Maximum Damage Window target만 후보 marker로 보냅니다.
const markerCall = compute.indexOf(
    'mark_maximum_damage_window_candidate(',
    reserveCall
);
assert.ok(markerCall > reserveCall);
assert.ok(targetDamageCall > markerCall);
assert.match(
    compute,
    /if \(gameplay_damage_resolution_policy_id\([\s\S]*?GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW[\s\S]*?mark_maximum_damage_window_candidate\(\s*contact_index,\s*final_damage,\s*policy_event_flag\s*\);[\s\S]*?return;/
);
assert.match(compute, /fn find_maximum_damage_window_candidate\([\s\S]*?for \(var contact_index = 0u;[\s\S]*?maximum_damage_window_candidate_is_better/);
const maximumDamageWindowFinderStart = compute.indexOf(
    'fn find_maximum_damage_window_candidate('
);
const maximumDamageWindowFinderEnd = compute.indexOf(
    'fn maximum_damage_window_target_is_configured(',
    maximumDamageWindowFinderStart
);
const maximumDamageWindowFinder = compute.slice(
    maximumDamageWindowFinderStart,
    maximumDamageWindowFinderEnd
);
assert.match(
    maximumDamageWindowFinder,
    /var policy_event_flag = maximum_damage_window_policy_from_marker\(marker\)/
);
assert.doesNotMatch(maximumDamageWindowFinder, /contact_handlers/);
assert.match(compute, /const MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC: u32 = 0x7fc00000u;/);
assert.match(compute, /const MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC_MASK: u32 = 0xfffffff0u;/);
assert.match(compute, /fn maximum_damage_window_marker_for_policy\(policy_event_flag: u32\)[\s\S]*?MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER[\s\S]*?MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS/);
assert.match(compute, /fn maximum_damage_window_policy_from_marker\(marker: u32\)[\s\S]*?MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC_MASK[\s\S]*?return 0u;/);
// 유한 normalized normal의 대표 bit pattern은 quiet-NaN namespace marker가 아니므로
// valid candidate로 오인되지 않습니다. marker는 allowed policy payload만 decode합니다.
assert.equal(decodeMaximumDamageWindowMarkerReference(0x00000000), 0);
assert.equal(decodeMaximumDamageWindowMarkerReference(0x3f800000), 0);
assert.equal(decodeMaximumDamageWindowMarkerReference(0xbf800000), 0);
assert.equal(decodeMaximumDamageWindowMarkerReference(0x7fc00000), 0);
assert.equal(decodeMaximumDamageWindowMarkerReference(0x7fc00001), 1);
assert.equal(decodeMaximumDamageWindowMarkerReference(0x7fc00002), 2);
assert.equal(decodeMaximumDamageWindowMarkerReference(0x7fc00003), 0);
assert.match(compute, /fn maximum_damage_window_candidate_is_better\([\s\S]*?candidate\.final_damage > current\.final_damage[\s\S]*?candidate\.source_entity_id < current\.source_entity_id[\s\S]*?candidate\.source_incarnation < current\.source_incarnation/);
assert.match(compute, /fn preflight_maximum_damage_window\([\s\S]*?find_maximum_damage_window_candidate\(body_id\)[\s\S]*?maximum_damage_window_event_count/);
assert.match(compute, /@compute @workgroup_size\(1\)\s*fn finalize_maximum_damage_window_preflight\([\s\S]*?existing_event_count[\s\S]*?maximum_damage_window_event_count[\s\S]*?params\.max_events[\s\S]*?event_overflow/);
assert.match(compute, /fn resolve_maximum_damage_window\([\s\S]*?clear_maximum_damage_window_state\(body_id\);[\s\S]*?params\.fixed_tick \+ duration[\s\S]*?damage\.applied/);
assert.match(compute, /fn clear_maximum_damage_window_state\([\s\S]*?peak_final_damage_fixed_point[\s\S]*?expires_at_fixed_tick[\s\S]*?peak_source_entity_id[\s\S]*?peak_source_incarnation/);
assert.match(compute, /MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE/);
const maximumDamageWindowPreflightStart = compute.indexOf('fn preflight_maximum_damage_window(');
const maximumDamageWindowResolveStart = compute.indexOf(
    'fn resolve_maximum_damage_window('
);
const maximumDamageWindowResolverEnd = compute.indexOf(
    'fn handle_contacts(',
    maximumDamageWindowResolveStart
);
const maximumDamageWindowPreflight = compute.slice(
    maximumDamageWindowPreflightStart,
    maximumDamageWindowResolveStart
);
const maximumDamageWindowResolver = compute.slice(
    maximumDamageWindowResolveStart,
    maximumDamageWindowResolverEnd
);
assert.match(
    maximumDamageWindowPreflight,
    /let window_is_active = params\.fixed_tick < expires_at_fixed_tick;[\s\S]*?if \(!window_is_active[\s\S]*?!maximum_damage_window_tick_is_representable\(duration\)\)/
);
assert.match(
    maximumDamageWindowPreflight,
    /candidate\.found == 0u[\s\S]*?atomicLoad\(&simulations\.values\[body_id\]\.health\) > 0[\s\S]*?maximum_damage_window_event_count/
);
assert.match(
    maximumDamageWindowResolver,
    /let window_is_active = params\.fixed_tick < expires_at_fixed_tick;[\s\S]*?max\(candidate\.final_damage - current_peak, 0\)[\s\S]*?damage\.applied,[\s\S]*?APPLIED_EVENT_FLAG_MAXIMUM_DAMAGE_WINDOW/
);
const activePeakBranchStart = maximumDamageWindowResolver.indexOf(
    '} else if (candidate.final_damage > current_peak) {'
);
const activePeakBranchEnd = maximumDamageWindowResolver.indexOf(
    'let damage = apply_target_damage',
    activePeakBranchStart
);
const activePeakBranch = maximumDamageWindowResolver.slice(
    activePeakBranchStart,
    activePeakBranchEnd
);
assert.ok(activePeakBranchStart >= 0 && activePeakBranchEnd > activePeakBranchStart);
assert.match(activePeakBranch, /peak_final_damage_fixed_point[\s\S]*?peak_source_entity_id[\s\S]*?peak_source_incarnation/);
assert.doesNotMatch(activePeakBranch, /expires_at_fixed_tick|params\.fixed_tick \+ duration/);
assert.doesNotMatch(
    maximumDamageWindowResolver,
    /existing_event_count|maximum_damage_window_event_count|atomicAdd\(\s*&contact_state\.event_overflow/
);
assert.doesNotMatch(maximumDamageWindowResolver, /if \(damage\.applied <= 0\)[\s\S]*?return;/);
assert.doesNotMatch(compute, /\blet active\b/);

// Typed Core request는 exact selected Core contact만 별도 preflight/resolve하며 Core HP를 GPU에서 바꾸지 않습니다.
assert.match(compute, /const CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST: u32 = 32u;/);
assert.match(compute, /const APPLIED_EVENT_TYPE_CORE_DAMAGE_REQUEST: u32 = 6u;/);
assert.match(compute, /const ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE: u32 = 2u;/);
assert.match(compute, /const CORE_DAMAGE_REQUEST_MARKER_MAGIC: u32 = 0x7fc00020u;/);
const coreDamageMarkerStart = compute.indexOf(
    'fn mark_core_damage_request_candidate('
);
const coreDamageMarkerEnd = compute.indexOf(
    'fn contact_is_core_damage_request_candidate(',
    coreDamageMarkerStart
);
assert.ok(
    coreDamageMarkerStart >= 0 && coreDamageMarkerEnd > coreDamageMarkerStart
);
const coreDamageMarkerBlock = compute.slice(
    coreDamageMarkerStart,
    coreDamageMarkerEnd
);
// quiet-NaN marker의 u32 identity는 유지하되 Dawn이 NaN constant-expression을
// 평가하지 않도록 function-scope var load 뒤에만 f32 bitcast합니다.
assert.match(
    coreDamageMarkerBlock,
    /var marker_bits: u32 = CORE_DAMAGE_REQUEST_MARKER_MAGIC;[\s\S]*?bitcast<f32>\(marker_bits\);/
);
assert.doesNotMatch(
    compute,
    /bitcast<f32>\(CORE_DAMAGE_REQUEST_MARKER_MAGIC\)/
);
assert.match(
    compute,
    /fn contact_is_core_damage_request_candidate\(contact: Contact\)[\s\S]*?bitcast<u32>\(contact\.normal\.y\)[\s\S]*?CORE_DAMAGE_REQUEST_MARKER_MAGIC_MASK[\s\S]*?== CORE_DAMAGE_REQUEST_MARKER_MAGIC;/
);
const handleContactsStart = compute.indexOf('fn handle_contacts(');
const coreValidationStart = compute.indexOf(
    'fn core_damage_request_candidate_is_valid(',
    handleContactsStart
);
const handleContactsBlock = compute.slice(handleContactsStart, coreValidationStart);
assert.match(
    handleContactsBlock,
    /CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST[\s\S]*?BODY_LAYER_CORE_PROXY[\s\S]*?mark_core_damage_request_candidate\(contact_index\);[\s\S]*?return;/
);
assert.match(compute, /const SELECTED_TARGET_TOWER_MARKER_MAGIC: u32 = 0x7fc00030u;/);
assert.match(
    handleContactsBlock,
    /CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST[\s\S]*?BODY_LAYER_PLAYER_DAMAGEABLE[\s\S]*?mark_selected_target_tower_candidate\([\s\S]*?return;/
);
assert.doesNotMatch(handleContactsBlock, /enemy_behavior_states/);
assert.match(
    compute,
    /fn selected_target_tower_candidate_is_valid\([\s\S]*?BODY_LAYER_PLAYER_DAMAGEABLE[\s\S]*?target_interaction_layer_mask[\s\S]*?GAMEPLAY_TEAM_HOSTILE[\s\S]*?ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE[\s\S]*?maximum_damage_window_target_is_configured/
);
assert.match(
    compute,
    /fn selected_target_tower_candidate_is_valid\([\s\S]*?BODY_CONTROL_SELECTED_TARGET_TOWER[\s\S]*?target_slot[\s\S]*?target_entity_id[\s\S]*?target_incarnation/
);
const coreResolveStart = compute.indexOf('fn resolve_core_damage_requests(');
const coreResolveEnd = compute.indexOf('fn emit_enemy_charge_telegraphs(', coreResolveStart);
const coreResolveBlock = compute.slice(coreResolveStart, coreResolveEnd);
assert.match(
    compute,
    /fn core_damage_request_candidate_is_valid\([\s\S]*?CONTACT_HANDLER_FLAG_CLOSEST_ONLY[\s\S]*?CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY[\s\S]*?BODY_LAYER_PROJECTILE[\s\S]*?BODY_LAYER_CORE_PROXY[\s\S]*?GAMEPLAY_TEAM_HOSTILE[\s\S]*?ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE[\s\S]*?target_slot[\s\S]*?target_entity_id[\s\S]*?target_incarnation/
);
assert.match(
    compute,
    /fn preflight_core_damage_requests\([\s\S]*?core_damage_request_candidate_is_valid[\s\S]*?core_damage_request_event_count/
);
assert.match(
    compute,
    /fn finalize_core_damage_request_preflight\([\s\S]*?request_count[\s\S]*?maximum_window_count[\s\S]*?params\.max_events[\s\S]*?event_overflow/
);
assert.match(
    coreResolveBlock,
    /core_damage_request_candidate_is_valid\(contact\)[\s\S]*?reserve_self_hit_budget\(self_body_id, damage_self\)[\s\S]*?core_damage_fixed_point[\s\S]*?APPLIED_EVENT_TYPE_CORE_DAMAGE_REQUEST/
);
assert.match(
    coreResolveBlock,
    /selected_target_tower_candidate_is_valid\(contact\)[\s\S]*?reserve_self_hit_budget\(self_body_id, damage_self\)[\s\S]*?mark_maximum_damage_window_candidate/
);
assert.doesNotMatch(coreResolveBlock, /apply_target_damage|\.health\s*=|atomicSub/);
assert.match(
    compute,
    /fn finalize_maximum_damage_window_preflight\([\s\S]*?maximum_damage_window_event_count[\s\S]*?core_damage_request_event_count[\s\S]*?event_overflow/
);

// 두 Tower의 exact-fit은 모두 commit하고, 하나 모자라면 preflight finalize가
// resolver 전에 전체를 fail-close하여 HP/window 어느 쪽도 mutate하지 않습니다.
const twoTowerBase = [{
    id: 1,
    health: 1000,
    peakFinalDamage: 0,
    expiresAtFixedTick: 0,
    peakSourceEntityId: 0xffffffff,
    peakSourceIncarnation: 0xffffffff,
    duration: 60,
    candidate: { finalDamage: 100, entityId: 8, incarnation: 2 }
}, {
    id: 2,
    health: 1000,
    peakFinalDamage: 0,
    expiresAtFixedTick: 0,
    peakSourceEntityId: 0xffffffff,
    peakSourceIncarnation: 0xffffffff,
    duration: 60,
    candidate: { finalDamage: 300, entityId: 7, incarnation: 4 }
}];
const exactFit = resolveMaximumDamageWindowBatchReference({
    existingEventCount: 0,
    maxEvents: 2,
    fixedTick: 40,
    towers: twoTowerBase
});
assert.equal(exactFit.protocolFailure, false);
assert.deepEqual(exactFit.events, [{
    towerId: 1,
    damageApplied: 100,
    entityId: 8,
    incarnation: 2
}, {
    towerId: 2,
    damageApplied: 300,
    entityId: 7,
    incarnation: 4
}]);
assert.deepEqual(
    exactFit.towers.map(({ health, peakFinalDamage, expiresAtFixedTick }) => ({
        health,
        peakFinalDamage,
        expiresAtFixedTick
    })),
    [
        { health: 900, peakFinalDamage: 100, expiresAtFixedTick: 100 },
        { health: 700, peakFinalDamage: 300, expiresAtFixedTick: 100 }
    ]
);
const activeLargerPeak = resolveMaximumDamageWindowBatchReference({
    existingEventCount: 0,
    maxEvents: 1,
    fixedTick: 80,
    towers: [{
        id: 3,
        health: 900,
        peakFinalDamage: 100,
        expiresAtFixedTick: 100,
        peakSourceEntityId: 8,
        peakSourceIncarnation: 2,
        duration: 60,
        candidate: { finalDamage: 300, entityId: 5, incarnation: 1 }
    }]
});
assert.deepEqual(activeLargerPeak.towers[0], {
    id: 3,
    health: 700,
    peakFinalDamage: 300,
    expiresAtFixedTick: 100,
    peakSourceEntityId: 5,
    peakSourceIncarnation: 1,
    duration: 60,
    candidate: { finalDamage: 300, entityId: 5, incarnation: 1 }
});
const expiredStartsFreshWindow = resolveMaximumDamageWindowBatchReference({
    existingEventCount: 0,
    maxEvents: 1,
    fixedTick: 100,
    towers: [{
        ...activeLargerPeak.towers[0],
        candidate: { finalDamage: 400, entityId: 4, incarnation: 9 }
    }]
});
assert.equal(expiredStartsFreshWindow.towers[0].expiresAtFixedTick, 160);
assert.equal(expiredStartsFreshWindow.towers[0].peakFinalDamage, 400);
const oneShort = resolveMaximumDamageWindowBatchReference({
    existingEventCount: 0,
    maxEvents: 1,
    fixedTick: 40,
    towers: twoTowerBase
});
assert.equal(oneShort.protocolFailure, true);
assert.equal(oneShort.eventOverflow, 1);
assert.deepEqual(oneShort.events, []);
assert.deepEqual(oneShort.towers, twoTowerBase);

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
const pairCorrectionStart = compute.indexOf('fn pair_correction(');
const pairCorrectionEnd = compute.indexOf('@compute @workgroup_size(64)', pairCorrectionStart);
const pairCorrectionBlock = compute.slice(pairCorrectionStart, pairCorrectionEnd);
assert.match(
    pairCorrectionBlock,
    /let inverse_mass_sum = self_body\.inverse_mass \+ other_body\.inverse_mass;[\s\S]*?let delta_lambda = penetration \/ \(inverse_mass_sum \+ alpha\);[\s\S]*?delta_lambda \* self_body\.inverse_mass/
);
assert.doesNotMatch(pairCorrectionBlock, /interaction_meta|interaction_mask|interaction_layer/);

// Tower weight 10의 inverseMass=.1은 light/heavy pair 모두에서 reciprocal mass ratio를 지킨다.
assert.equal(THE_TOWER_DATA.WEIGHT, 10);
const towerInverseMass = 1 / THE_TOWER_DATA.WEIGHT;
assertNear(towerInverseMass, 0.1);
const lightEnemyInverseMass = 1 / 0.6;
const mediumEnemyInverseMass = 1 / 3;
const heavyEnemyInverseMass = 1 / 30;
const pairAlpha = 0.125;
const towerVsLight = pairCorrectionMagnitude(
    towerInverseMass,
    lightEnemyInverseMass,
    1,
    pairAlpha
);
const lightVsTower = pairCorrectionMagnitude(
    lightEnemyInverseMass,
    towerInverseMass,
    1,
    pairAlpha
);
assert.ok(towerVsLight > 0 && lightVsTower > towerVsLight);
assertNear(lightVsTower / towerVsLight, lightEnemyInverseMass / towerInverseMass);
const towerVsMedium = pairCorrectionMagnitude(
    towerInverseMass,
    mediumEnemyInverseMass,
    1,
    pairAlpha
);
const mediumVsTower = pairCorrectionMagnitude(
    mediumEnemyInverseMass,
    towerInverseMass,
    1,
    pairAlpha
);
assert.ok(towerVsMedium > 0 && mediumVsTower > towerVsMedium);
assertNear(mediumVsTower / towerVsMedium, mediumEnemyInverseMass / towerInverseMass);
const towerVsHeavy = pairCorrectionMagnitude(
    towerInverseMass,
    heavyEnemyInverseMass,
    1,
    pairAlpha
);
const heavyVsTower = pairCorrectionMagnitude(
    heavyEnemyInverseMass,
    towerInverseMass,
    1,
    pairAlpha
);
assert.ok(towerVsHeavy > heavyVsTower && heavyVsTower > 0);
assertNear(towerVsHeavy / heavyVsTower, towerInverseMass / heavyEnemyInverseMass);

// Enemy-Enemy의 서로 다른 weight도 같은 ratio이며 interaction flag와 독립적으로 solve된다.
const lightVsHeavyEnemy = pairCorrectionMagnitude(
    lightEnemyInverseMass,
    heavyEnemyInverseMass,
    1,
    pairAlpha
);
const heavyVsLightEnemy = pairCorrectionMagnitude(
    heavyEnemyInverseMass,
    lightEnemyInverseMass,
    1,
    pairAlpha
);
assert.ok(lightVsHeavyEnemy > heavyVsLightEnemy && heavyVsLightEnemy > 0);
assertNear(
    lightVsHeavyEnemy / heavyVsLightEnemy,
    lightEnemyInverseMass / heavyEnemyInverseMass
);
const interactionEnabledPairCorrection = pairCorrectionMagnitude(
    towerInverseMass,
    lightEnemyInverseMass,
    1,
    pairAlpha
);
assert.equal(interactionEnabledPairCorrection, towerVsLight);

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
assert.match(render, /@group\(0\) @binding\(5\) var<storage, read> enemy_behavior_states: EnemyBehaviorStateBuffer;/);
assert.match(render, /counts\.abi_version != BODY_ABI_VERSION/);
assert.match(render, /if \(\(simulation_flags & 1u\) == 0u\)[\s\S]*?output\.color = vec4f\(0\.0\);[\s\S]*?return output;/);
assert.match(indirect, /counts\.abi_version != BODY_ABI_VERSION[\s\S]*?draw_args\.instance_count = 0u/);

// 모든 compute entrypoint는 mismatch에서 fail closed하고 clear_contact_state는 status를 남깁니다.
assert.ok((compute.match(/if \(!abi_is_current\(\)\)/g) ?? []).length >= 13);
assert.match(compute, /contact_state\.abi_status[\s\S]*?CONTACT_ABI_STATUS_MISMATCH/);

console.log('gpu projectile contact shader contract: ok');
