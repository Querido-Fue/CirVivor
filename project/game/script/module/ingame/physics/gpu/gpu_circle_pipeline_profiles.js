/** Exact pipeline profile authority shared by setup and fixed dispatch. */
export const COMPUTE_ENTRY_POINTS = Object.freeze([
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
    'prepare_bodies',
    'clear_grid',
    'build_tick_start_grid',
    'build_grid',
    'clear_contact_state',
    'clear_enemy_charge_impact_states',
    'emit_enemy_charge_telegraphs',
    'generate_body_contacts',
    'generate_world_contacts',
    'select_enemy_charge_impact_contacts',
    'materialize_enemy_charge_impact_evidence',
    'classify_directional_defense_contacts',
    'clear_atomic_transform_first_hit_candidates',
    'select_atomic_transform_first_hit_source',
    'resolve_atomic_transform_first_hit_contact',
    'seal_atomic_transform_first_hits',
    'commit_atomic_transform_first_hits',
    'finalize_atomic_transform_first_hits',
    'shield_atomic_transform_first_hit_contacts',
    'shield_unselected_enemy_charge_contacts',
    'handle_contacts',
    'preflight_core_damage_requests',
    'finalize_core_damage_request_preflight',
    'resolve_core_damage_requests',
    'resolve_direct_core_damage_requests',
    'resolve_enemy_charge_contacts',
    'preflight_maximum_damage_window',
    'finalize_maximum_damage_window_preflight',
    'resolve_maximum_damage_window',
    'mark_dead',
    'clear_position_deltas',
    'solve_body_body',
    'solve_body_world',
    'apply_position_deltas',
    'rebuild_velocities',
    'finalize_velocities',
    'finalize_controlled_motion',
    'apply_enemy_charge_impact_impulses',
    'pack_tracked_pose'
]);

export const COMPUTE_PIPELINE_PROFILE = Object.freeze({
    PHYSICS: 'physics',
    BODY_CONTACTS: 'body-contacts',
    WORLD_CONTACTS: 'world-contacts',
    CONTACT_HANDLING: 'contact-handling',
    MAXIMUM_DAMAGE_WINDOW: 'maximum-damage-window',
    CORE_DAMAGE_REQUEST: 'core-damage-request',
    DIRECT_CORE_DAMAGE_REQUEST: 'direct-core-damage-request',
    FIXED_CONTROL: 'fixed-control',
    SOURCE_RESOLVE: 'source-resolve',
    ENEMY_BEHAVIOR: 'enemy-behavior',
    ENEMY_CHARGE_IMPACT: 'enemy-charge-impact',
    DIRECTIONAL_DEFENSE_CLASSIFIER: 'directional-defense-classifier',
    ATOMIC_TRANSFORM_FIRST_HIT: 'atomic-transform-first-hit',
    TRACKED_POSE: 'tracked-pose'
});

export const COMPUTE_PIPELINE_PROFILE_BY_ENTRY_POINT = Object.freeze({
    validate_source_relative_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    resolve_source_relative_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    validate_selected_target_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    resolve_selected_target_spawns: COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE,
    clear_body_control_states: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    validate_body_control_commands: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    apply_body_control_commands: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    apply_controlled_motion: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    advance_octagon_orbit: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    advance_enemy_charge: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    prepare_bodies: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    clear_grid: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    build_tick_start_grid: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    build_grid: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    clear_contact_state: COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING,
    clear_enemy_charge_impact_states:
        COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT,
    emit_enemy_charge_telegraphs: COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR,
    generate_body_contacts: COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS,
    generate_world_contacts: COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS,
    select_enemy_charge_impact_contacts:
        COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT,
    materialize_enemy_charge_impact_evidence:
        COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT,
    classify_directional_defense_contacts:
        COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER,
    clear_atomic_transform_first_hit_candidates:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    select_atomic_transform_first_hit_source:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    resolve_atomic_transform_first_hit_contact:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    seal_atomic_transform_first_hits:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    commit_atomic_transform_first_hits:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    finalize_atomic_transform_first_hits:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    shield_atomic_transform_first_hit_contacts:
        COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT,
    shield_unselected_enemy_charge_contacts:
        COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT,
    handle_contacts: COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING,
    preflight_core_damage_requests:
        COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST,
    finalize_core_damage_request_preflight:
        COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST,
    resolve_core_damage_requests:
        COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST,
    resolve_direct_core_damage_requests:
        COMPUTE_PIPELINE_PROFILE.DIRECT_CORE_DAMAGE_REQUEST,
    resolve_enemy_charge_contacts:
        COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT,
    preflight_maximum_damage_window: COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW,
    finalize_maximum_damage_window_preflight:
        COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW,
    resolve_maximum_damage_window: COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW,
    mark_dead: COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING,
    clear_position_deltas: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    solve_body_body: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    solve_body_world: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    apply_position_deltas: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    rebuild_velocities: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    finalize_velocities: COMPUTE_PIPELINE_PROFILE.PHYSICS,
    finalize_controlled_motion: COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL,
    apply_enemy_charge_impact_impulses:
        COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT,
    pack_tracked_pose: COMPUTE_PIPELINE_PROFILE.TRACKED_POSE
});

export const REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE = 9;
