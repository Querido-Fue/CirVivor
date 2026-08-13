import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE
} = await loadGameModule('data/object/enemy/basic_octa_enemy_data.js');
const {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE,
    GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_RENDER_WGSL,
    GPU_DIRECTIONAL_DEFENSE_CONTACT_MARKER
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');

const SIMULATION_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const LIFECYCLE_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js',
    import.meta.url
), 'utf8');
const ENDPOINT_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');
const GAME_OBJECT_SYSTEM_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/game_object_system.js',
    import.meta.url
), 'utf8');
const RUNNER_SOURCE = await readFile(new URL(
    './nw_webgpu_capability/enemy_octagon_directional_defense_runner.js',
    import.meta.url
), 'utf8');
const SUPPORT_SOURCE = await readFile(new URL(
    './support/run_nw_webgpu_capability.mjs',
    import.meta.url
), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `missing source marker: ${startMarker}`);
    assert.ok(end > start, `missing source end marker: ${endMarker}`);
    return source.slice(start, end);
}

test('program3 raw SEEK 80-byte overlay와 O data는 facing/slot/reduction exact ABI를 공유한다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 80);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.STRIDE, 80);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.FACING_X, 32);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.FACING_Y, 36);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.ORBIT_RADIUS_TILES, 40);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.COORDINATE_SYSTEM_CODE, 52);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.ORBIT_SLOT_INDEX, 56);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.ORBIT_SLOT_CAPACITY, 60);
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.ANGULAR_STEP_Q32, 64);
    assert.equal(
        GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.FLAT_REDUCTION_FIXED_POINT,
        68
    );
    assert.equal(GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI.FACET_CONFIG, 72);
    assert.equal(GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT, 3);
    assert.equal(GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER, 1);
    assert.equal(GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER, 7);
    assert.equal(
        GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE,
        1 << 6
    );
    assert.equal(GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA, 8);
    assert.equal(GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE, 1 << 14);
    assert.equal(BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.orbitRadiusTiles,
        Math.fround(6));
    assert.equal(
        BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.directionalDefense
            .flatReductionFixedPoint,
        50
    );
    assert.deepEqual({ ...GPU_CIRCLE_BODY_ABI.COMBAT_STATE }, {
        STRIDE: 40,
        TARGET_INTERACTION_LAYER_MASK: 0,
        MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS: 4,
        PEAK_FINAL_DAMAGE_FIXED_POINT: 8,
        EXPIRES_AT_FIXED_TICK: 12,
        PEAK_SOURCE_ENTITY_ID: 16,
        PEAK_SOURCE_INCARNATION: 20,
        RESERVED_0: 24,
        RESERVED_1: 28,
        RESERVED_2: 32,
        RESERVED_3: 36
    });
});

test('orbit pass는 route-flow SEEK→radius capture→bounded angular settle와 Core fallback latch를 고정한다', () => {
    const orbitPass = sourceSlice(
        GPU_COLLISION_COMPUTE_WGSL,
        'fn advance_octagon_orbit',
        'fn advance_enemy_charge'
    );
    assert.match(orbitPass,
        /program_id[\s\S]*ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT/);
    assert.match(orbitPass,
        /state == ENEMY_BEHAVIOR_STATE_CORE_FALLBACK[\s\S]*enter_enemy_core_fallback\(body_id\)[\s\S]*return;/);
    assert.match(orbitPass,
        /state != ENEMY_BEHAVIOR_STATE_SEEK_TOWER[\s\S]*state != ENEMY_BEHAVIOR_STATE_ORBIT_TOWER[\s\S]*!tower_gameplay_target_is_valid\(\)[\s\S]*enter_enemy_core_fallback\(body_id\)/);
    assert.match(orbitPass,
        /behavior_target_matches_gameplay_tower\(body_id\)/);
    assert.match(orbitPass,
        /ENEMY_ORBIT_SLOT_ZERO_PHASE_Q32[\s\S]*charge_max_ticks << 29u[\s\S]*params\.fixed_tick[\s\S]*recover_ticks/);
    assert.match(orbitPass,
        /let allowed_seek_flags = ENEMY_BEHAVIOR_FLAG_TARGET_VALID[\s\S]*allowed_active_flags[\s\S]*ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE/);
    assert.match(orbitPass,
        /facing = target_position - physics\.values\[body_id\]\.position/);
    assert.match(orbitPass,
        /charge_direction = facing/);
    assert.match(orbitPass,
        /state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER[\s\S]*allowed_seek_flags[\s\S]*atomicOr\([\s\S]*BODY_FLAG_USE_FLOW[\s\S]*facing_length_squared > orbit_radius \* orbit_radius[\s\S]*ENEMY_BEHAVIOR_STATE_ORBIT_TOWER/);
    assert.match(orbitPass,
        /disable_enemy_flow\(body_id\)[\s\S]*allowed_active_flags/);
    assert.match(orbitPass,
        /current_radial[\s\S]*radial_cross[\s\S]*signed_angle_error[\s\S]*maximum_angular_step[\s\S]*settle_angle = clamp[\s\S]*settle_radial/);
    assert.match(orbitPass,
        /abs\(radial_cross\)[\s\S]*radial_dot < 0\.0[\s\S]*charge_max_ticks & 1u/);
    assert.match(GPU_COLLISION_COMPUTE_WGSL,
        /ENEMY_ORBIT_SLOT_ZERO_PHASE_Q32:\s*u32 = 0x80000000u/);
    assert.doesNotMatch(orbitPass, /combat_states/);
});

test('classifier pass는 transient contact.normal marker로 inclusive front 3/8 facet만 감소시킨다', () => {
    assert.deepEqual({ ...GPU_DIRECTIONAL_DEFENSE_CONTACT_MARKER }, {
        MAGIC: 0x7fc00040,
        MAGIC_MASK: 0xfffffff0
    });
    const classifier = sourceSlice(
        GPU_COLLISION_COMPUTE_WGSL,
        'fn classify_directional_defense_contacts',
        'struct DamageResult'
    );
    assert.match(classifier, /contact\.self_incarnation/);
    assert.match(classifier, /contact\.other_incarnation/);
    assert.match(classifier, /ENEMY_BEHAVIOR_STATE_ORBIT_TOWER/);
    assert.match(classifier, /behavior_target_matches_gameplay_tower/);
    assert.match(classifier,
        /ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE/);
    assert.match(classifier,
        /incoming_delta = temporaries\.values\[source_body_id\]\.predicted_position[\s\S]*temporaries\.values\[target_body_id\]\.predicted_position/);
    assert.match(classifier,
        /incoming_distance_squared <= EPSILON_DISTANCE_SQUARED[\s\S]*return;/);
    assert.match(classifier,
        /incoming_direction = incoming_delta[\s\S]*inverseSqrt\(incoming_distance_squared\)/);
    assert.match(classifier,
        /target_facing = facing \* inverseSqrt/);
    assert.match(classifier,
        /armored_half_angle = 3\.141592653589793[\s\S]*armored_facet_count[\s\S]*total_facet_count/);
    assert.match(classifier,
        /dot\(target_facing, incoming_direction\) < cos\(armored_half_angle\)/);
    assert.match(classifier,
        /contacts\.values\[contact_index\]\.normal = vec2f\([\s\S]*bitcast<f32>\(flat_reduction\)[\s\S]*directional_defense_marker_payload\(\)/);
    assert.match(GPU_COLLISION_COMPUTE_WGSL,
        /fn directional_defense_marker_payload\(\) -> f32[\s\S]*marker_bits:\s*u32 = DIRECTIONAL_DEFENSE_MARKER_MAGIC[\s\S]*bitcast<f32>\(marker_bits\)/);
    assert.doesNotMatch(classifier, /combat_states/);
    assert.doesNotMatch(classifier, /minimum|min_damage|random/iu);
});

test('generic handler는 team/stale gate 뒤 budget을 소비하고 flat 50을 minimum 없이 적용한다', () => {
    const handler = sourceSlice(
        GPU_COLLISION_COMPUTE_WGSL,
        'fn handle_contacts',
        'fn preflight_core_damage_requests'
    );
    const staleIndex = handler.indexOf('simulations.values[other_body_id].incarnation');
    const teamIndex = handler.indexOf('gameplay_damage_is_allowed');
    const budgetIndex = handler.indexOf('reserve_self_hit_budget');
    const mitigationIndex = handler.indexOf('resolve_contact_target_mitigation');
    assert.ok(staleIndex >= 0 && teamIndex > staleIndex);
    assert.ok(budgetIndex > teamIndex);
    assert.ok(mitigationIndex > budgetIndex);
    assert.match(GPU_COLLISION_COMPUTE_WGSL,
        /source_modified_damage - directional_defense_flat_reduction\(contact\)[\s\S]*0/);
    assert.match(handler,
        /directional_defense_event_flag = select\([\s\S]*APPLIED_EVENT_FLAG_DIRECTIONAL_DEFENSE[\s\S]*directional_flat_reduction > 0[\s\S]*final_damage <= 0[\s\S]*Valid fully absorbed hits consume the source\/self budget[\s\S]*directional_defense_event_flag/);
    assert.match(handler,
        /damage\.applied[\s\S]*directional_defense_event_flag/);
    assert.doesNotMatch(handler, /max\(final_damage,\s*1\)|minimum_damage/);
});

test('capture 후 render는 같은 Behavior facing을 읽고 armored three facets를 표시한다', () => {
    const vertex = sourceSlice(
        GPU_COLLISION_RENDER_WGSL,
        '@vertex',
        '@fragment'
    );
    const fragment = GPU_COLLISION_RENDER_WGSL.slice(
        GPU_COLLISION_RENDER_WGSL.indexOf('@fragment')
    );
    assert.match(vertex, /let behavior = enemy_behavior_states\.values\[instance_index\]/);
    assert.match(vertex,
        /directional_defense_active[\s\S]*presentation_velocity = behavior\.charge_direction/);
    assert.match(fragment,
        /input\.shape_code == RENDER_SHAPE_OCTA[\s\S]*input\.directional_defense_active/);
    assert.match(fragment,
        /directional_local_position\([\s\S]*input\.velocity/);
    assert.match(fragment,
        /3\.0 \* 3\.141592653589793[\s\S]*8\.0/);
    assert.match(fragment, /armored_sector[\s\S]*mix\(/);
    assert.doesNotMatch(vertex, /combat_states/);
});

test('simulation ordering/storage와 dedicated author fixture routing을 exact 고정한다', () => {
    const appliedEventDecoder = sourceSlice(
        SIMULATION_SOURCE,
        'function decodeAppliedEvent',
        'function decodeDeathEvent'
    );
    const endpointEventNormalizer = sourceSlice(
        ENDPOINT_SOURCE,
        '    #normalizeCompletedEvent(source, context) {',
        '    #isCompletedEventIdentityLive(event) {'
    );
    const orbitDispatch = SIMULATION_SOURCE.indexOf(
        "this.#dispatchBodies(pass, 'advance_octagon_orbit')"
    );
    const chargeDispatch = SIMULATION_SOURCE.indexOf(
        "this.#dispatchBodies(pass, 'advance_enemy_charge')"
    );
    const bodyContacts = SIMULATION_SOURCE.indexOf(
        "this.#dispatchBodies(pass, 'generate_body_contacts')"
    );
    const classifier = SIMULATION_SOURCE.indexOf(
        'this.pipelines.compute.classify_directional_defense_contacts'
    );
    const handler = SIMULATION_SOURCE.indexOf(
        'this.pipelines.compute.handle_contacts'
    );
    assert.ok(orbitDispatch >= 0 && chargeDispatch > orbitDispatch);
    assert.ok(bodyContacts > chargeDispatch);
    assert.ok(classifier > bodyContacts);
    assert.ok(handler > classifier);
    assert.match(SIMULATION_SOURCE,
        /classify_directional_defense_contacts:\s*\n?\s*COMPUTE_PIPELINE_PROFILE\.DIRECTIONAL_DEFENSE_CLASSIFIER/);
    assert.match(SIMULATION_SOURCE,
        /DIRECTIONAL_DEFENSE_CLASSIFIER:\s*'directional-defense-classifier'/);
    assert.match(SIMULATION_SOURCE,
        /computeDirectionalDefenseBodiesLayout[\s\S]*storageLayoutEntry\(0\)[\s\S]*storageLayoutEntry\(1\)[\s\S]*storageLayoutEntry\(2\)[\s\S]*storageLayoutEntry\(3\)[\s\S]*storageLayoutEntry\(11\)[\s\S]*storageLayoutEntry\(13, 'read-only-storage'\)/);
    assert.match(SIMULATION_SOURCE,
        /computeDirectionalDefenseEventsLayout[\s\S]*entries:\s*\[0, 1\]/);
    assert.match(SIMULATION_SOURCE,
        /enemyBehavior:\s*9/);
    assert.match(SIMULATION_SOURCE,
        /contactHandling:\s*9/);
    assert.match(SIMULATION_SOURCE,
        /maximumDamageWindow:\s*9/);
    assert.match(appliedEventDecoder,
        /Number\(maximumDamageWindow\)[\s\S]*Number\(directionalDefense\)[\s\S]*Number\(atomicTransformTriggerFirstHit\) > 1[\s\S]*if \(unknownFlags !== 0[\s\S]*\|\| contactFlagsInvalid[\s\S]*throw new RangeError/);
    assert.match(endpointEventNormalizer,
        /directionalDefense !== encodedDirectionalDefense[\s\S]*throw new RangeError/);
    assert.match(endpointEventNormalizer,
        /Number\(maximumDamageWindow\)[\s\S]*Number\(directionalDefense\)[\s\S]*Number\(atomicTransformTriggerFirstHit\) > 1[\s\S]*throw new RangeError/);
    assert.match(endpointEventNormalizer,
        /allowsZeroDamage = eventType === 'damage-applied'[\s\S]*maximumDamageWindow[\s\S]*\|\| directionalDefense[\s\S]*\|\| atomicTransformTriggerFirstHit/);
    assert.match(endpointEventNormalizer,
        /valueFixedPoint === 0 && targetDied/);
    assert.match(SIMULATION_SOURCE,
        /requiredMaximum:\s*REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE/);
    assert.match(SIMULATION_SOURCE,
        /renderBodyStorageBindings\.length[\s\S]*GPU_FORMATION_RUNTIME_STORAGE_PROFILE\.render/);
    assert.match(LIFECYCLE_SOURCE,
        /isOctaDefinition !== hasOrbitBehaviorProgram/);
    assert.doesNotMatch(
        `${ENDPOINT_SOURCE}\n${GAME_OBJECT_SYSTEM_SOURCE}`,
        /OctagonOrbitDirector|EnemyOrbitDirector|getOrbitCommandPort|orbitDirectorStatus|orbitRecoveryStatus/
    );

    assert.match(RUNNER_SOURCE, /GpuEnemySimulationEndpoint/);
    assert.match(RUNNER_SOURCE, /EnemySimulationBackend/);
    assert.match(RUNNER_SOURCE, /navigator\.gpu\.requestAdapter/);
    assert.match(RUNNER_SOURCE, /createGpuEnemySpawnIntent/);
    assert.match(RUNNER_SOURCE, /requestSpawnBatch/);
    assert.match(RUNNER_SOURCE, /createOpenOrbitTileMap/);
    assert.doesNotMatch(RUNNER_SOURCE, /\bcreateTileMap\(/);
    assert.match(RUNNER_SOURCE, /createGpuSignedDistanceFieldSnapshot/);
    assert.match(RUNNER_SOURCE, /phaseBaseQ32:\s*0x80000000/);
    assert.match(RUNNER_SOURCE,
        /ORBIT_CAPTURE_SEED_RADIUS[\s\S]*assertCaptureSeedInside/);
    assert.match(RUNNER_SOURCE,
        /runNaturalSeekCapture[\s\S]*initialDefenseActive:\s*false[\s\S]*captureDefenseActive/);
    assert.match(RUNNER_SOURCE,
        /runSeekTowerLossLatch[\s\S]*modeBefore:\s*'SEEK_TOWER'[\s\S]*latchedMode:\s*'CORE_FALLBACK'/);
    assert.match(RUNNER_SOURCE, /frontDamageCenti/);
    assert.match(RUNNER_SOURCE, /frontBoundaryOutsideDamageCenti/);
    assert.match(RUNNER_SOURCE, /fullyAbsorbedBudgetAfter/);
    assert.match(RUNNER_SOURCE, /shieldRearTargetDamageEventCount/);
    assert.match(RUNNER_SOURCE,
        /shieldOctaRearDistance[\s\S]*shieldEnemyPairCollisionRadius/);
    assert.match(RUNNER_SOURCE, /staleRejectionCode/);
    assert.match(RUNNER_SOURCE, /frontArmorScore/);
    assert.match(RUNNER_SOURCE, /rearArmorScore/);
    assert.match(RUNNER_SOURCE,
        /'zero-direction'[\s\S]*coincident:\s*true/);
    assert.match(RUNNER_SOURCE,
        /zeroDirectionPredictedDeltaSquared[\s\S]*=== 0/);
    assert.match(RUNNER_SOURCE,
        /zeroDirectionDamageCenti:\s*zeroDirection\.appliedDamageCenti/);
    assert.match(RUNNER_SOURCE, /modeAfter:\s*'CORE_FALLBACK'/);
    assert.match(RUNNER_SOURCE, /oldSessionGeneration/);
    assert.match(RUNNER_SOURCE,
        /freshRawOrbitSlotBefore[\s\S]*freshOrbitSlotAfter/);
    assert.match(SUPPORT_SOURCE, /enemy-octagon-directional-defense/);
    assert.match(SUPPORT_SOURCE, /activeHandles\.length === 3/);
    assert.match(SUPPORT_SOURCE, /frontDamageCenti === 50/);
    assert.match(SUPPORT_SOURCE, /captureDefenseActive === true/);
    assert.match(SUPPORT_SOURCE, /shieldRearTargetDamageEventCount === 0/);
    assert.match(SUPPORT_SOURCE,
        /shieldOctaRearDistance[\s\S]*shieldEnemyPairCollisionRadius/);
    assert.match(SUPPORT_SOURCE, /staleRejectionCode === 'stale-handle'/);
    assert.match(SUPPORT_SOURCE,
        /damage\.mapIds[\s\S]*nw-octagon-open-orbit-authority/);
    assert.match(SUPPORT_SOURCE, /classifier === 8/);
    assert.match(SUPPORT_SOURCE, /contactHandling === 9/);
});
