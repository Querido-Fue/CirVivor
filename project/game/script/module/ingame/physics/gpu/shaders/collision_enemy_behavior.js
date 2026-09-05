

export const COLLISION_ENEMY_BEHAVIOR_WGSL = /* wgsl */`fn tower_target_query_is_valid(source_body_id: u32) -> bool {
    if (source_body_id >= counts.body_count
        || source_body_id >= arrayLength(&tower_target_queries.values)) {
        return false;
    }
    let query = tower_target_queries.values[source_body_id];
    if ((query.flags & (TOWER_TARGET_QUERY_FLAG_VALID
            | TOWER_TARGET_QUERY_FLAG_SOURCE_VALID))
            != (TOWER_TARGET_QUERY_FLAG_VALID
                | TOWER_TARGET_QUERY_FLAG_SOURCE_VALID)
        || query.source_entity_id
            != simulations.values[source_body_id].entity_id
        || query.source_incarnation
            != simulations.values[source_body_id].incarnation
        || query.target_slot >= counts.body_count) {
        return false;
    }
    let target_slot = query.target_slot;
    return simulations.values[target_slot].entity_id
            == query.target_entity_id
        && simulations.values[target_slot].incarnation
            == query.target_incarnation
        && body_id_is_alive(target_slot)
        && body_interaction_layer(physics.values[target_slot].interaction_meta)
            == BODY_LAYER_PLAYER_DAMAGEABLE
        && gameplay_meta_is_valid(simulations.values[target_slot].gameplay_meta)
        && gameplay_team_id(simulations.values[target_slot].gameplay_meta)
            == GAMEPLAY_TEAM_PLAYER;
}

fn tower_target_query_roster_changed(source_body_id: u32) -> bool {
    return source_body_id < arrayLength(&tower_target_queries.values)
        && (tower_target_queries.values[source_body_id].flags
            & TOWER_TARGET_QUERY_FLAG_ROSTER_CHANGED) != 0u;
}

fn behavior_target_matches_gameplay_tower(body_id: u32) -> bool {
    if (!tower_target_query_is_valid(body_id)) { return false; }
    let query = tower_target_queries.values[body_id];
    let flags = atomicLoad(&enemy_behavior_states.values[body_id].flags);
    return (flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
        && enemy_behavior_states.values[body_id].target_slot
            == query.target_slot
        && enemy_behavior_states.values[body_id].target_entity_id
            == query.target_entity_id
        && enemy_behavior_states.values[body_id].target_incarnation
            == query.target_incarnation;
}

fn bind_behavior_target_to_gameplay_tower(body_id: u32) {
    let query = tower_target_queries.values[body_id];
    enemy_behavior_states.values[body_id].target_slot
        = query.target_slot;
    enemy_behavior_states.values[body_id].target_entity_id
        = query.target_entity_id;
    enemy_behavior_states.values[body_id].target_incarnation
        = query.target_incarnation;
    atomicOr(
        &enemy_behavior_states.values[body_id].flags,
        ENEMY_BEHAVIOR_FLAG_TARGET_VALID
    );
}

fn set_enemy_behavior_state(
    body_id: u32,
    state: u32,
    expires_at_fixed_tick: u32
) {
    atomicStore(&enemy_behavior_states.values[body_id].state, state);
    enemy_behavior_states.values[body_id].state_entered_fixed_tick
        = params.fixed_tick;
    enemy_behavior_states.values[body_id].state_expires_at_fixed_tick
        = expires_at_fixed_tick;
}

fn enter_enemy_core_fallback(body_id: u32) {
    if (atomicLoad(&enemy_behavior_states.values[body_id].state)
        != ENEMY_BEHAVIOR_STATE_CORE_FALLBACK) {
        set_enemy_behavior_state(
            body_id,
            ENEMY_BEHAVIOR_STATE_CORE_FALLBACK,
            0u
        );
    }
    enemy_behavior_states.values[body_id].target_slot = 0u;
    enemy_behavior_states.values[body_id].target_entity_id = 0u;
    enemy_behavior_states.values[body_id].target_incarnation = 0u;
    enemy_behavior_states.values[body_id].charge_direction = vec2f(0.0);
    atomicStore(&enemy_behavior_states.values[body_id].flags, 0u);
    restore_enemy_route_flow(body_id);
}

fn disable_enemy_flow(body_id: u32) {
    atomicAnd(&simulations.values[body_id].flags, ~BODY_FLAG_USE_FLOW);
    atomicOr(
        &simulations.values[body_id].flags,
        BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK
    );
}

fn restore_enemy_route_flow(body_id: u32) {
    // flow_field_index/stage는 immutable route atlas authority입니다. 여기서는
    // ownership bit만 되돌려 direct Tower motion이 다음 prepare를 덮지 못하게 합니다.
    atomicOr(&simulations.values[body_id].flags, BODY_FLAG_USE_FLOW);
    atomicAnd(
        &simulations.values[body_id].flags,
        ~BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK
    );
}

fn clear_enemy_charge_route_fallback_latch(body_id: u32) {
    atomicAnd(
        &enemy_behavior_states.values[body_id].flags,
        ~ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK
    );
}

fn enter_enemy_charge_route_fallback(body_id: u32) {
    atomicStore(
        &enemy_behavior_states.values[body_id].flags,
        ENEMY_BEHAVIOR_FLAG_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK
    );
}

fn enemy_charge_target_is_separated(body_id: u32) -> bool {
    let target_slot = enemy_behavior_states.values[body_id].target_slot;
    if (target_slot >= counts.body_count
        || simulations.values[target_slot].entity_id
            != enemy_behavior_states.values[body_id].target_entity_id
        || simulations.values[target_slot].incarnation
            != enemy_behavior_states.values[body_id].target_incarnation) {
        return true;
    }
    let delta = physics.values[body_id].position
        - physics.values[target_slot].position;
    let separation_distance = body_interaction_radius_values(
        physics.values[body_id].radius,
        physics.values[body_id].interaction_meta
    ) + body_interaction_radius_values(
        physics.values[target_slot].radius,
        physics.values[target_slot].interaction_meta
    );
    return dot(delta, delta) >= separation_distance * separation_distance;
}

fn damp_enemy_charge_recoil_velocity(body_id: u32) {
    var velocity = physics.values[body_id].velocity
        * clamp(enemy_behavior_states.values[body_id].recoil_damping, 0.0, 1.0);
    let sleep_threshold = max(
        enemy_behavior_states.values[body_id].recoil_sleep_threshold,
        0.0
    );
    if (dot(velocity, velocity) <= sleep_threshold * sleep_threshold) {
        velocity = vec2f(0.0);
    }
    physics.values[body_id].velocity = velocity;
}

fn encode_enemy_charge_velocity_delta(component: f32) -> i32 {
    let contribution_limit = ENEMY_CHARGE_IMPACT_FIXED_POINT_LIMIT
        / i32(max(counts.body_count, 1u));
    return i32(round(clamp(
        component * ENEMY_CHARGE_IMPACT_FIXED_POINT_SCALE,
        -f32(contribution_limit),
        f32(contribution_limit)
    )));
}

fn enemy_charge_segment_is_visible(body_id: u32, segment_end: vec2f) -> bool {
    if (params.sdf_enabled == 0u) {
        return true;
    }
    let body = physics.values[body_id];
    let segment_start = body.position;
    let segment = segment_end - segment_start;
    let segment_length_squared = dot(segment, segment);
    let clearance_radius = body.radius
        + max(params.source_world_unit_scale * 0.25, 0.0001);
    if (segment_length_squared <= EPSILON_DISTANCE_SQUARED) {
        return sample_world_sdf(segment_start) > clearance_radius;
    }
    let segment_length = sqrt(segment_length_squared);
    let direction = segment * inverseSqrt(segment_length_squared);
    let minimum_step = max(params.source_world_unit_scale * 0.25, 0.0001);
    var travelled = 0.0;
    for (var step_index = 0u;
        step_index < ENEMY_CHARGE_VISIBILITY_MAX_STEPS;
        step_index += 1u) {
        let clearance = sample_world_sdf(segment_start + direction * travelled)
            - clearance_radius;
        if (clearance <= 0.0) {
            return false;
        }
        if (travelled >= segment_length) {
            return true;
        }
        // Clearance is a lower bound to terrain. Taking 75% leaves an SDF
        // interpolation margin while still bounding long clear corridor checks.
        travelled = min(
            travelled + max(clearance * 0.75, minimum_step),
            segment_length
        );
    }
    // A bounded marcher must fail closed rather than let direct ownership tunnel
    // through an unverified long/degenerate segment.
    return false;
}

fn octagon_orbit_config_is_valid(body_id: u32) -> bool {
    let facet_config = enemy_behavior_states.values[body_id].telegraph_color_rgba8;
    let armored_facet_count = facet_config & 65535u;
    let total_facet_count = (facet_config >> 16u) & 65535u;
    return enemy_behavior_states.values[body_id].windup_range > 0.0
        && enemy_behavior_states.values[body_id].windup_range
            <= 3.402823466e+38
        && enemy_behavior_states.values[body_id].windup_ticks
            == ENEMY_ORBIT_COORDINATE_SYSTEM_RING_SLOTS
        && enemy_behavior_states.values[body_id].charge_max_ticks
            < enemy_behavior_states.values[body_id].recoil_ticks
        && enemy_behavior_states.values[body_id].recoil_ticks
            == ENEMY_ORBIT_SLOT_CAPACITY
        && enemy_behavior_states.values[body_id].recover_ticks != 0u
        && bitcast<i32>(enemy_behavior_states.values[body_id]
            .telegraph_style_code) > 0
        && armored_facet_count == 3u
        && total_facet_count == ENEMY_ORBIT_SLOT_CAPACITY
        && enemy_behavior_states.values[body_id].charge_speed == 0.0
        && enemy_behavior_states.values[body_id].impact_restitution == 0.0
        && enemy_behavior_states.values[body_id].telegraph_radius_scale == 0.0
        && enemy_behavior_states.values[body_id]
            .deprecated_charge_acceleration == 0.0
        && enemy_behavior_states.values[body_id]
            .impact_tangential_retention == 0.0
        && enemy_behavior_states.values[body_id].recoil_damping == 0.0
        && enemy_behavior_states.values[body_id].recoil_sleep_threshold == 0.0;
}

fn rotate_octagon_orbit_radial(radial: vec2f, angle: f32) -> vec2f {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec2f(
        radial.x * cosine - radial.y * sine,
        radial.x * sine + radial.y * cosine
    );
}

@compute @workgroup_size(256)
fn advance_octagon_orbit(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT
        || !body_id_is_alive(body_id)) {
        return;
    }
    var state = atomicLoad(&enemy_behavior_states.values[body_id].state);
    // O의 data-owned 정책은 roster revision이 바뀐 경우에만 fallback latch를 풉니다.
    if (state == ENEMY_BEHAVIOR_STATE_CORE_FALLBACK) {
        if (!tower_target_query_is_valid(body_id)
            || !tower_target_query_roster_changed(body_id)) {
            enter_enemy_core_fallback(body_id);
            return;
        }
        bind_behavior_target_to_gameplay_tower(body_id);
        set_enemy_behavior_state(body_id, ENEMY_BEHAVIOR_STATE_SEEK_TOWER, 0u);
        state = ENEMY_BEHAVIOR_STATE_SEEK_TOWER;
    }
    if ((state != ENEMY_BEHAVIOR_STATE_SEEK_TOWER
            && state != ENEMY_BEHAVIOR_STATE_ORBIT_TOWER)
        || !octagon_orbit_config_is_valid(body_id)
        || !tower_target_query_is_valid(body_id)) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    let previous_flags = atomicLoad(&enemy_behavior_states.values[body_id].flags);
    let allowed_seek_flags = ENEMY_BEHAVIOR_FLAG_TARGET_VALID;
    let allowed_active_flags = ENEMY_BEHAVIOR_FLAG_TARGET_VALID
        | ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE;
    let flags_match_state = select(
        previous_flags == allowed_active_flags,
        previous_flags == 0u || previous_flags == allowed_seek_flags,
        state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER
    );
    if (!flags_match_state) {
        enter_enemy_core_fallback(body_id);
        return;
    }
    if ((previous_flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
        && !behavior_target_matches_gameplay_tower(body_id)) {
        if (!tower_target_query_roster_changed(body_id)) {
            enter_enemy_core_fallback(body_id);
            return;
        }
        set_enemy_behavior_state(body_id, ENEMY_BEHAVIOR_STATE_SEEK_TOWER, 0u);
        state = ENEMY_BEHAVIOR_STATE_SEEK_TOWER;
    }
    bind_behavior_target_to_gameplay_tower(body_id);

    let phase_word = ENEMY_ORBIT_SLOT_ZERO_PHASE_Q32
        + (enemy_behavior_states.values[body_id].charge_max_ticks << 29u)
        + (params.fixed_tick
            * enemy_behavior_states.values[body_id].recover_ticks);
    let angle = f32(phase_word) * ENEMY_ORBIT_PHASE_RADIANS_PER_Q32;
    let desired_radial = vec2f(cos(angle), sin(angle));
    let target_slot = tower_target_queries.values[body_id].target_slot;
    let target_position = physics.values[target_slot].position;
    var facing = target_position - physics.values[body_id].position;
    let facing_length_squared = dot(facing, facing);
    if (facing_length_squared <= EPSILON_DISTANCE_SQUARED) {
        facing = -desired_radial;
    } else {
        facing *= inverseSqrt(facing_length_squared);
    }
    enemy_behavior_states.values[body_id].charge_direction = facing;

    let orbit_radius = enemy_behavior_states.values[body_id].windup_range;
    if (state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER) {
        // 접근 중에는 route flow와 exact Tower-facing만 유지합니다. 방어는 실제
        // radius capture 뒤에만 활성화되어 멀리서 생기는 가짜 armored hit를 막습니다.
        atomicStore(
            &enemy_behavior_states.values[body_id].flags,
            allowed_seek_flags
        );
        atomicOr(&simulations.values[body_id].flags, BODY_FLAG_USE_FLOW);
        atomicAnd(
            &simulations.values[body_id].flags,
            ~BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK
        );
        if (facing_length_squared > orbit_radius * orbit_radius) {
            return;
        }
        set_enemy_behavior_state(
            body_id,
            ENEMY_BEHAVIOR_STATE_ORBIT_TOWER,
            0u
        );
    }

    // Capture 뒤에는 exact Tower orbit이 velocity를 소유합니다.
    disable_enemy_flow(body_id);
    atomicStore(
        &enemy_behavior_states.values[body_id].flags,
        allowed_active_flags
    );

    let body_position = physics.values[body_id].position;
    let current_delta = body_position - target_position;
    let current_distance_squared = dot(current_delta, current_delta);
    var current_radial = desired_radial;
    if (current_distance_squared > EPSILON_DISTANCE_SQUARED) {
        current_radial = current_delta * inverseSqrt(current_distance_squared);
    }
    let radial_dot = clamp(dot(current_radial, desired_radial), -1.0, 1.0);
    let radial_cross = current_radial.x * desired_radial.y
        - current_radial.y * desired_radial.x;
    var turn_direction = select(-1.0, 1.0, radial_cross >= 0.0);
    if (abs(radial_cross) <= EPSILON_MASS && radial_dot < 0.0) {
        // Exact opposite slot은 entity/order와 무관한 slot parity로 tie-break합니다.
        turn_direction = select(
            -1.0,
            1.0,
            (enemy_behavior_states.values[body_id].charge_max_ticks & 1u) == 0u
        );
    }
    let signed_angle_error = acos(radial_dot) * turn_direction;
    let maximum_speed = max(simulations.values[body_id].flow_speed, 0.0);
    let maximum_angular_step = select(
        0.0,
        maximum_speed * max(params.dt, 0.0) / orbit_radius,
        orbit_radius > EPSILON_MASS
    );
    let settle_angle = clamp(
        signed_angle_error,
        -maximum_angular_step,
        maximum_angular_step
    );
    let settle_radial = rotate_octagon_orbit_radial(
        current_radial,
        settle_angle
    );
    let desired_position = target_position + settle_radial * orbit_radius;
    let position_error = desired_position - body_position;
    var desired_velocity = position_error * max(params.inverse_dt, 0.0);
    let desired_speed_squared = dot(desired_velocity, desired_velocity);
    if (maximum_speed <= 0.0) {
        desired_velocity = vec2f(0.0);
    } else if (desired_speed_squared > maximum_speed * maximum_speed) {
        desired_velocity *= maximum_speed * inverseSqrt(desired_speed_squared);
    }
    physics.values[body_id].velocity = desired_velocity;
}

@compute @workgroup_size(256)
fn advance_enemy_charge(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        || !body_id_is_alive(body_id)) {
        return;
    }
    let state = atomicLoad(&enemy_behavior_states.values[body_id].state);
    if (!tower_target_query_is_valid(body_id)) {
        physics.values[body_id].velocity = vec2f(0.0);
        enter_enemy_core_fallback(body_id);
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_CORE_FALLBACK) {
        bind_behavior_target_to_gameplay_tower(body_id);
        // CORE_FALLBACK may follow a cancelled direct charge/recoil. Never let
        // that cached external velocity leak into the route-owned first tick.
        physics.values[body_id].velocity = vec2f(0.0);
        clear_enemy_charge_route_fallback_latch(body_id);
        restore_enemy_route_flow(body_id);
        set_enemy_behavior_state(body_id, ENEMY_BEHAVIOR_STATE_SEEK_TOWER, 0u);
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_SEEK_TOWER) {
        let flags = atomicLoad(&enemy_behavior_states.values[body_id].flags);
        if ((flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
            && !behavior_target_matches_gameplay_tower(body_id)) {
            physics.values[body_id].velocity = vec2f(0.0);
            enter_enemy_core_fallback(body_id);
            return;
        }
        bind_behavior_target_to_gameplay_tower(body_id);
        let target_slot = tower_target_queries.values[body_id].target_slot;
        let target_position = physics.values[target_slot].position;
        let to_target = target_position - physics.values[body_id].position;
        let distance_squared = dot(to_target, to_target);
        if (!enemy_charge_segment_is_visible(body_id, target_position)) {
            // First blocked direct->route handoff clears stale charge/recoil
            // velocity. Later blocked SEEK ticks carry the private latch and keep
            // their atlas-smoothed flow velocity rather than restarting at zero.
            let behavior_flags = atomicLoad(
                &enemy_behavior_states.values[body_id].flags
            );
            if ((behavior_flags
                & ENEMY_BEHAVIOR_FLAG_ARROW_ROUTE_FALLBACK) == 0u) {
                physics.values[body_id].velocity = vec2f(0.0);
            }
            restore_enemy_route_flow(body_id);
            enter_enemy_charge_route_fallback(body_id);
            return;
        }
        clear_enemy_charge_route_fallback_latch(body_id);
        disable_enemy_flow(body_id);
        let windup_range = enemy_behavior_states.values[body_id].windup_range;
        if (distance_squared <= windup_range * windup_range) {
            physics.values[body_id].velocity = vec2f(0.0);
            atomicStore(
                &enemy_behavior_states.values[body_id].flags,
                ENEMY_BEHAVIOR_FLAG_TARGET_VALID
                    | ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING
            );
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_WINDUP,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].windup_ticks
            );
            return;
        }
        if (distance_squared > EPSILON_DISTANCE_SQUARED) {
            physics.values[body_id].velocity = to_target
                * inverseSqrt(distance_squared)
                * max(simulations.values[body_id].flow_speed, 0.0);
        } else {
            physics.values[body_id].velocity = vec2f(0.0);
        }
        return;
    }
    if (!behavior_target_matches_gameplay_tower(body_id)) {
        physics.values[body_id].velocity = vec2f(0.0);
        enter_enemy_core_fallback(body_id);
        return;
    }
    disable_enemy_flow(body_id);
    if (state == ENEMY_BEHAVIOR_STATE_WINDUP) {
        physics.values[body_id].velocity = vec2f(0.0);
        if (params.fixed_tick
            < enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            return;
        }
        let target_slot = enemy_behavior_states.values[body_id].target_slot;
        if (!enemy_charge_segment_is_visible(
            body_id,
            physics.values[target_slot].position
        )) {
            physics.values[body_id].velocity = vec2f(0.0);
            restore_enemy_route_flow(body_id);
            enter_enemy_charge_route_fallback(body_id);
            set_enemy_behavior_state(body_id, ENEMY_BEHAVIOR_STATE_SEEK_TOWER, 0u);
            return;
        }
        var direction = physics.values[target_slot].position
            - physics.values[body_id].position;
        let direction_squared = dot(direction, direction);
        if (direction_squared <= EPSILON_DISTANCE_SQUARED) {
            direction = deterministic_separation_normal(body_id, target_slot);
        } else {
            direction *= inverseSqrt(direction_squared);
        }
        enemy_behavior_states.values[body_id].charge_direction = direction;
        clear_enemy_charge_route_fallback_latch(body_id);
        atomicStore(
            &enemy_behavior_states.values[body_id].flags,
            ENEMY_BEHAVIOR_FLAG_TARGET_VALID
        );
        set_enemy_behavior_state(
            body_id,
            ENEMY_BEHAVIOR_STATE_CHARGE,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].charge_max_ticks
        );
        // WINDUP 종료 시 authored speed를 exact-once로 부여합니다. CHARGE는
        // 이 velocity를 다시 가속하거나 덮어쓰지 않습니다.
        physics.values[body_id].velocity = direction
            * enemy_behavior_states.values[body_id].charge_speed;
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_CHARGE) {
        if (params.fixed_tick
            >= enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            physics.values[body_id].velocity = vec2f(0.0);
            clear_enemy_charge_route_fallback_latch(body_id);
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_RECOVER,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].recover_ticks
            );
            return;
        }
        let charge_velocity = physics.values[body_id].velocity;
        let charge_segment_end = physics.values[body_id].position
            + charge_velocity * max(params.dt, 0.0);
        if (!enemy_charge_segment_is_visible(
            body_id,
            charge_segment_end
        )) {
            // Terrain is not an exact Tower contact. Leave the target intact but
            // suppress both charge damage and recoil by leaving CHARGE before the
            // contact passes, then boundedly reacquire through SEEK after RECOVER.
            physics.values[body_id].velocity = vec2f(0.0);
            clear_enemy_charge_route_fallback_latch(body_id);
            atomicStore(
                &enemy_behavior_states.values[body_id].flags,
                ENEMY_BEHAVIOR_FLAG_TARGET_VALID
            );
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_RECOVER,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].recover_ticks
            );
            return;
        }
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL) {
        // Ordinary reconstruction 뒤 적용된 contact impulse만 감쇠합니다. 이
        // phase는 scripted reverse/Expo velocity를 생성하지 않습니다.
        damp_enemy_charge_recoil_velocity(body_id);
        if (params.fixed_tick
                >= enemy_behavior_states.values[body_id].state_expires_at_fixed_tick
            && enemy_charge_target_is_separated(body_id)) {
            clear_enemy_charge_route_fallback_latch(body_id);
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_RECOVER,
                params.fixed_tick
                    + enemy_behavior_states.values[body_id].recover_ticks
            );
        }
        return;
    }
    if (state == ENEMY_BEHAVIOR_STATE_RECOVER) {
        physics.values[body_id].velocity = vec2f(0.0);
        if (params.fixed_tick
            >= enemy_behavior_states.values[body_id].state_expires_at_fixed_tick) {
            clear_enemy_charge_route_fallback_latch(body_id);
            set_enemy_behavior_state(
                body_id,
                ENEMY_BEHAVIOR_STATE_SEEK_TOWER,
                0u
            );
        }
        return;
    }
    physics.values[body_id].velocity = vec2f(0.0);
    enter_enemy_core_fallback(body_id);
}

`;
