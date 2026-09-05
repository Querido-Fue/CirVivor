

export const COLLISION_INTEGRATION_GRID_WGSL = /* wgsl */`@compute @workgroup_size(256)
fn prepare_bodies(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    let current = physics.values[body_id].position;
    var velocity = physics.values[body_id].velocity;
    let simulation_flags = load_simulation_flags(body_id);
    temporaries.values[body_id].previous_flow_field_index
        = simulations.values[body_id].flow_field_index;
    if (!body_is_alive(simulation_flags)) {
        temporaries.values[body_id].previous_position = current;
        temporaries.values[body_id].predicted_position = current;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        temporaries.values[body_id].grid_index = -1;
        return;
    }
    let lifetime = simulations.values[body_id].lifetime;
    if (lifetime >= 0.0) {
        simulations.values[body_id].lifetime = max(lifetime - params.dt, 0.0);
    }
    // Captured projectile lifetime은 계속 흐르지만 normal movement는 정지합니다.
    if (body_has_flag(simulation_flags, BODY_FLAG_PROJECTILE_CAPTURED)) {
        physics.values[body_id].velocity = vec2f(0.0);
        temporaries.values[body_id].previous_position = current;
        temporaries.values[body_id].predicted_position = current;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        temporaries.values[body_id].grid_index = -1;
        return;
    }
    if (params.flow_enabled != 0u
        && params.flow_field_count > 0u
        && body_has_flag(simulation_flags, BODY_FLAG_USE_FLOW)
        && !body_has_flag(simulation_flags, BODY_FLAG_CONTROLLED_THIS_TICK)
        && simulations.values[body_id].flow_field_index < params.flow_field_count) {
        let cell = flow_cell_for_position(current);
        var field_index = simulations.values[body_id].flow_field_index;
        var stage = params.flow_stages[field_index];
        var reached_final_goal = false;
        if (route_stage_transition_reached(
            field_index,
            temporaries.values[body_id].previous_position,
            current,
            stage
        )) {
            if (stage.next_field_index >= 0
                && u32(stage.next_field_index) < params.flow_field_count) {
                field_index = u32(stage.next_field_index);
                simulations.values[body_id].flow_field_index = field_index;
                stage = params.flow_stages[field_index];
            } else {
                reached_final_goal = true;
            }
        }

        if (reached_final_goal) {
            velocity = vec2f(0.0);
        } else {
            var direction = flow_direction(field_index, cell);
            if (abs(direction.x) < EPSILON_MASS && abs(direction.y) < EPSILON_MASS) {
                direction = stage.goal_position - current;
            }
            let direction_length = length(direction);
            if (direction_length >= EPSILON_MASS) {
                direction /= direction_length;
                let maximum_speed = max(simulations.values[body_id].flow_speed, 0.0);
                let adjustment_factor = min(params.dt, 1.0);
                velocity = mix(
                    velocity,
                    direction * maximum_speed,
                    vec2f(adjustment_factor)
                );
                let speed = length(velocity);
                if (speed > maximum_speed) {
                    velocity = (velocity / speed) * maximum_speed;
                }
            }
        }
    }
    if (velocity.x != velocity.x) {
        velocity.x = 0.0;
    }
    if (velocity.y != velocity.y) {
        velocity.y = 0.0;
    }
    temporaries.values[body_id].previous_position = current;
    temporaries.values[body_id].predicted_position = current;
    if (physics.values[body_id].inverse_mass > EPSILON_MASS) {
        temporaries.values[body_id].predicted_position = current
            + (velocity * params.dt);
    }
    temporaries.values[body_id].position_delta = vec2f(0.0);
    temporaries.values[body_id].grid_index = -1;
}

@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let index = global_id.x;
    let total_bucket_count = grid_cell_total() * 2u;
    if (index < total_bucket_count) {
        atomicStore(&grid_counts.values[index], 0u);
    }
    if (index == 0u) {
        atomicStore(&grid_overflow.small_count, 0u);
        atomicStore(&grid_overflow.big_count, 0u);
    }
}

// Effect pulse/Formation 계열 capability가 movement 전의 exact tick-start world를
// 공유하도록 physics.position에서 기존 grid ABI를 재사용합니다.
@compute @workgroup_size(256)
fn build_tick_start_grid(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_simulation_active(body_id)) {
        return;
    }
    let body = physics.values[body_id];
    let position = body.position;
    let footprint = collision_grid_footprint(position, body.radius);
    if (footprint.valid == 0u) {
        return;
    }
    let grid_body = make_grid_body(body_id, position);
    let max_per_cell = params.max_bodies_per_cell;
    if (footprint.bucket == 0u) {
        let counter_index = collision_grid_counter_index(
            footprint.center,
            footprint.bucket
        );
        let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
        if (slot >= max_per_cell) {
            atomicAdd(&grid_overflow.small_count, 1u);
            atomicAdd(&grid_overflow.total_small_count, 1u);
            return;
        }
        let storage_index = (counter_index * max_per_cell) + slot;
        grid_bodies.values[storage_index] = grid_body;
        return;
    }

    for (var y = footprint.minimum_cell.y;
        y <= footprint.maximum_cell.y;
        y += 1) {
        for (var x = footprint.minimum_cell.x;
            x <= footprint.maximum_cell.x;
            x += 1) {
            let counter_index = collision_grid_counter_index(
                vec2i(x, y),
                footprint.bucket
            );
            let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
            if (slot >= max_per_cell) {
                atomicAdd(&grid_overflow.big_count, 1u);
                atomicAdd(&grid_overflow.total_big_count, 1u);
                continue;
            }
            grid_bodies.values[(counter_index * max_per_cell) + slot] = grid_body;
        }
    }
}

@compute @workgroup_size(256)
fn build_grid(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }

    temporaries.values[body_id].grid_index = -1;
    if (!body_id_is_simulation_active(body_id)) {
        return;
    }
    let predicted = temporaries.values[body_id].predicted_position;
    let body = physics.values[body_id];
    let footprint = collision_grid_footprint(predicted, body.radius);
    if (footprint.valid == 0u) {
        return;
    }
    let grid_body = make_grid_body(body_id, predicted);
    let max_per_cell = params.max_bodies_per_cell;
    if (footprint.bucket == 0u) {
        let counter_index = collision_grid_counter_index(
            footprint.center,
            footprint.bucket
        );
        let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
        if (slot >= max_per_cell) {
            atomicAdd(&grid_overflow.small_count, 1u);
            atomicAdd(&grid_overflow.total_small_count, 1u);
            return;
        }
        let storage_index = (counter_index * max_per_cell) + slot;
        grid_bodies.values[storage_index] = grid_body;
        temporaries.values[body_id].grid_index = i32(storage_index);
        return;
    }

    for (var y = footprint.minimum_cell.y;
        y <= footprint.maximum_cell.y;
        y += 1) {
        for (var x = footprint.minimum_cell.x;
            x <= footprint.maximum_cell.x;
            x += 1) {
            let counter_index = collision_grid_counter_index(
                vec2i(x, y),
                footprint.bucket
            );
            let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
            if (slot >= max_per_cell) {
                atomicAdd(&grid_overflow.big_count, 1u);
                atomicAdd(&grid_overflow.total_big_count, 1u);
                continue;
            }
            grid_bodies.values[(counter_index * max_per_cell) + slot] = grid_body;
        }
    }
}

`;
