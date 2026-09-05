

export const COLLISION_POSITION_SOLVER_WGSL = /* wgsl */`@compute @workgroup_size(256)
fn clear_position_deltas(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id < counts.body_count) {
        temporaries.values[body_id].position_delta = vec2f(0.0);
    }
}

fn physical_pair_minimum_distance(self_body: GridBody, other_body: GridBody) -> f32 {
    let radius_sum = self_body.radius + other_body.radius;
    let self_is_enemy = (body_layer(self_body.physical_meta) & BODY_LAYER_ENEMY) != 0u;
    let other_is_enemy = (body_layer(other_body.physical_meta) & BODY_LAYER_ENEMY) != 0u;
    if (self_is_enemy && other_is_enemy) {
        return radius_sum * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    }
    return radius_sum;
}

fn pair_correction(self_body: GridBody, other_body: GridBody, alpha: f32, big_pair: bool) -> vec2f {
    if (self_body.body_id == other_body.body_id) {
        return vec2f(0.0);
    }
    if (!body_id_is_simulation_active(other_body.body_id)) {
        return vec2f(0.0);
    }
    if ((body_collision_mask(self_body.physical_meta)
            & body_layer(other_body.physical_meta)) == 0u
        || (body_collision_mask(other_body.physical_meta)
            & body_layer(self_body.physical_meta)) == 0u) {
        return vec2f(0.0);
    }

    let delta = self_body.predicted_position - other_body.predicted_position;
    let distance_squared = dot(delta, delta);
    let minimum_distance = physical_pair_minimum_distance(self_body, other_body);
    if (distance_squared >= minimum_distance * minimum_distance) {
        return vec2f(0.0);
    }

    var normal = deterministic_separation_normal(
        self_body.body_id,
        other_body.body_id
    );
    var distance = 0.0;
    if (distance_squared > EPSILON_DISTANCE_SQUARED) {
        let inverse_distance = inverseSqrt(distance_squared);
        normal = delta * inverse_distance;
        distance = distance_squared * inverse_distance;
    }
    let penetration = minimum_distance - distance;
    let inverse_mass_sum = self_body.inverse_mass + other_body.inverse_mass;
    if (inverse_mass_sum <= EPSILON_MASS) {
        return vec2f(0.0);
    }
    let delta_lambda = penetration / (inverse_mass_sum + alpha);
    return normal * delta_lambda * self_body.inverse_mass;
}

@compute @workgroup_size(64)
fn solve_body_body(
    @builtin(local_invocation_id) local_id: vec3u,
    @builtin(workgroup_id) workgroup_id: vec3u
) {
    let local = local_id.x;
    let cell_index = workgroup_id.x;
    if (cell_index >= grid_cell_total()) {
        return;
    }

    if (local < 9u) {
        let cell = vec2i(
            i32(cell_index % params.grid_cell_count.x),
            i32(cell_index / params.grid_cell_count.x)
        );
        let neighbor = cell + NEIGHBOR_OFFSETS[local];
        if (neighbor.x < 0 || neighbor.y < 0
            || neighbor.x >= i32(params.grid_cell_count.x)
            || neighbor.y >= i32(params.grid_cell_count.y)) {
            neighbor_cell_counts[local] = 0u;
            neighbor_cell_indices[local] = 0u;
        } else {
            let neighbor_index = (u32(neighbor.y) * params.grid_cell_count.x) + u32(neighbor.x);
            neighbor_cell_counts[local] = min(
                atomicLoad(&grid_counts.values[neighbor_index * 2u]),
                params.max_bodies_per_cell
            );
            neighbor_cell_indices[local] = neighbor_index;
        }
        if (local == 4u) {
            current_cell_count = neighbor_cell_counts[local];
            current_big_count = min(
                atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
                params.max_bodies_per_cell
            );
        }
    }
    workgroupBarrier();

    // ABI version은 storage load이므로 WGSL uniformity analysis가 barrier 앞의
    // early-return 조건으로 인정하지 않습니다. 이 pass는 barrier 전에는
    // workgroup scratch만 쓰고, version 확인 뒤에만 body storage를 변경합니다.
    if (!abi_is_current()) {
        return;
    }

    if (local >= current_cell_count) {
        return;
    }
    let self_index = grid_bucket_offset(cell_index, 0u) + local;
    let self_body = grid_bodies.values[self_index];
    let collision_mask = body_collision_mask(self_body.physical_meta);
    if (self_body.inverse_mass <= EPSILON_MASS
        || self_body.radius <= 0.0
        || collision_mask == 0u
        || !body_id_is_simulation_active(self_body.body_id)) {
        return;
    }

    let soft_border = 8.0 * params.source_world_unit_scale;
    let distance_x = min(
        self_body.predicted_position.x,
        params.world_size.x - self_body.predicted_position.x
    );
    let distance_y = min(
        self_body.predicted_position.y,
        params.world_size.y - self_body.predicted_position.y
    );
    let border_factor = max(
        1.0 - smoothstep(0.0, soft_border, distance_x),
        1.0 - smoothstep(0.0, soft_border, distance_y)
    );
    let compliance = mix(0.000001, 0.001, border_factor);
    let alpha = compliance
        / (params.dt * params.dt * f32(max(params.solver_iterations, 1u)));
    var accumulated_delta = vec2f(0.0);

    for (var neighbor_slot = 0u; neighbor_slot < 9u; neighbor_slot += 1u) {
        let neighbor_index = neighbor_cell_indices[neighbor_slot];
        let neighbor_count = neighbor_cell_counts[neighbor_slot];
        let neighbor_offset = grid_bucket_offset(neighbor_index, 0u);
        for (var index = 0u; index < neighbor_count; index += 1u) {
            accumulated_delta += pair_correction(
                self_body,
                grid_bodies.values[neighbor_offset + index],
                alpha,
                false
            );
        }
    }

    let big_offset = grid_bucket_offset(cell_index, 1u);
    for (var index = 0u; index < current_big_count; index += 1u) {
        accumulated_delta += pair_correction(
            self_body,
            grid_bodies.values[big_offset + index],
            alpha,
            true
        );
    }
    temporaries.values[self_body.body_id].position_delta += accumulated_delta;
}

@compute @workgroup_size(256)
fn solve_body_world(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || params.sdf_enabled == 0u
        || !body_id_is_simulation_active(body_id)) {
        return;
    }
    let body = physics.values[body_id];
    if ((body_collision_mask(body.physical_meta) & BODY_LAYER_TERRAIN) == 0u
        || body.inverse_mass <= EPSILON_MASS) {
        return;
    }

    let predicted = temporaries.values[body_id].predicted_position;
    let candidate = predicted + temporaries.values[body_id].position_delta;
    let distance = sample_world_sdf(candidate);
    let penetration = body.radius - distance;
    if (penetration <= 0.0) {
        return;
    }

    let gradient_step = max(params.source_world_unit_scale, 0.0001);
    let gradient_uv_epsilon = vec2f(gradient_step) / params.world_size;
    var normal = vec2f(
        sample_world_sdf(candidate + vec2f(gradient_step, 0.0))
            - sample_world_sdf(candidate - vec2f(gradient_step, 0.0)),
        sample_world_sdf(candidate + vec2f(0.0, gradient_step))
            - sample_world_sdf(candidate - vec2f(0.0, gradient_step))
    ) / (gradient_uv_epsilon * 2.0);
    let normal_length = length(normal);
    if (normal_length < EPSILON_MASS) {
        let center_delta = (params.world_size * 0.5) - candidate;
        let center_distance = length(center_delta);
        normal = select(
            vec2f(1.0, 0.0),
            center_delta / center_distance,
            center_distance >= EPSILON_MASS
        );
    } else {
        normal /= normal_length;
    }
    temporaries.values[body_id].position_delta += normal * min(penetration, body.radius);
}

@compute @workgroup_size(256)
fn apply_position_deltas(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    if (!body_id_is_simulation_active(body_id)) {
        return;
    }
    temporaries.values[body_id].predicted_position += temporaries.values[body_id].position_delta;
    let grid_index = temporaries.values[body_id].grid_index;
    if (grid_index >= 0) {
        grid_bodies.values[u32(grid_index)].predicted_position
            = temporaries.values[body_id].predicted_position;
    }
}

fn is_inside_world(position: vec2f) -> bool {
    return position.x >= 0.0 && position.x < params.world_size.x
        && position.y >= 0.0 && position.y < params.world_size.y;
}

@compute @workgroup_size(256)
fn rebuild_velocities(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    if (!body_id_is_simulation_active(body_id)) {
        return;
    }
    if (grid_has_overflow()) {
        temporaries.values[body_id].predicted_position
            = temporaries.values[body_id].previous_position;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        physics.values[body_id].position = temporaries.values[body_id].previous_position;
        simulations.values[body_id].flow_field_index
            = temporaries.values[body_id].previous_flow_field_index;
        return;
    }
    var predicted = temporaries.values[body_id].predicted_position;
    var previous = temporaries.values[body_id].previous_position;
    if (!is_inside_world(predicted)
        && (body_layer(physics.values[body_id].physical_meta) & BODY_LAYER_ENEMY) != 0u
        && is_inside_world(previous)) {
        let clamp_margin = 0.1 * params.source_world_unit_scale;
        predicted = clamp(predicted, vec2f(0.0), params.world_size - vec2f(clamp_margin));
        previous = predicted;
    }
    physics.values[body_id].position = predicted;
    physics.values[body_id].velocity = (predicted - previous) * params.inverse_dt;
}

@compute @workgroup_size(256)
fn finalize_velocities(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || grid_has_overflow()
        || !body_id_is_simulation_active(body_id)) {
        return;
    }
    if (body_has_flag(
        load_simulation_flags(body_id),
        BODY_FLAG_CONTROLLED_THIS_TICK
    )) {
        return;
    }
    var velocity = physics.values[body_id].velocity
        * clamp(1.0 - (params.velocity_damping * params.dt), 0.0, 1.0);
    let speed_squared = dot(velocity, velocity);
    if (params.max_speed > 0.0 && speed_squared > params.max_speed * params.max_speed) {
        velocity = normalize(velocity) * params.max_speed;
    }
    physics.values[body_id].velocity = velocity;
}

@compute @workgroup_size(256)
fn finalize_controlled_motion(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || !body_id_is_simulation_active(body_id)) {
        return;
    }
    let control_state = body_control_states.values[body_id];
    if (control_state.entity_id != simulations.values[body_id].entity_id
        || control_state.incarnation != simulations.values[body_id].incarnation) {
        return;
    }
    if ((control_state.state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
        physics.values[body_id].velocity = vec2f(0.0);
        return;
    }
    if (!body_has_flag(
        load_simulation_flags(body_id),
        BODY_FLAG_CONTROLLED_THIS_TICK
    )) {
        return;
    }
    var velocity = physics.values[body_id].velocity;
    let controlled_speed = length(velocity);
    if (controlled_speed > CONTROL_MAX_LINEAR_SPEED) {
        velocity = (velocity / controlled_speed) * CONTROL_MAX_LINEAR_SPEED;
    }
    physics.values[body_id].velocity = velocity;
}

@compute @workgroup_size(256)
fn apply_enemy_charge_impact_impulses(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    // 이 pass는 ordinary rebuild/finalize 뒤 한 번만 호출됩니다. Exchange로
    // accumulator를 소비하므로 동일 tick의 두 번째 호출도 exact zero입니다.
    let delta_x_fixed_point = atomicExchange(
        &enemy_charge_impacts.values[body_id].velocity_delta_x_fixed_point,
        0
    );
    let delta_y_fixed_point = atomicExchange(
        &enemy_charge_impacts.values[body_id].velocity_delta_y_fixed_point,
        0
    );
    if (delta_x_fixed_point == 0 && delta_y_fixed_point == 0) {
        return;
    }
    physics.values[body_id].velocity += vec2f(
        f32(delta_x_fixed_point),
        f32(delta_y_fixed_point)
    ) / ENEMY_CHARGE_IMPACT_FIXED_POINT_SCALE;
}

@compute @workgroup_size(1)
fn pack_tracked_pose() {
    if (!abi_is_current()
        || tracked_pose_config.enabled == 0u
        || tracked_pose_config.source_slot >= counts.body_count) {
        invalidate_tracked_pose_output();
        return;
    }
    let source_slot = tracked_pose_config.source_slot;
    if (simulations.values[source_slot].entity_id != tracked_pose_config.entity_id
        || simulations.values[source_slot].incarnation
            != tracked_pose_config.incarnation
        || !body_id_is_alive(source_slot)) {
        invalidate_tracked_pose_output();
        return;
    }
    tracked_pose_output.position = physics.values[source_slot].position;
    tracked_pose_output.velocity = physics.values[source_slot].velocity;
    tracked_pose_output.previous_position
        = temporaries.values[source_slot].previous_position;
    tracked_pose_output.entity_id = tracked_pose_config.entity_id;
    tracked_pose_output.incarnation = tracked_pose_config.incarnation;
}
`;
