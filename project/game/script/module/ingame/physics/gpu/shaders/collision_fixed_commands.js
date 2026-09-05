

export const COLLISION_FIXED_COMMANDS_WGSL = /* wgsl */`@compute @workgroup_size(256)
fn clear_body_control_states(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    let previous = body_control_states.values[body_id];
    let retain_priority_state = previous.source_tick != 0u
        && previous.selection_policy
            == BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
        && previous.entity_id == simulations.values[body_id].entity_id
        && previous.incarnation == simulations.values[body_id].incarnation;
    if (!retain_priority_state) {
        body_control_states.values[body_id] = BodyControlState(
            vec2f(0.0),
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            0u,
            0u,
            0u,
            BODY_CONTROL_RESULT_PENDING,
            BODY_CONTROL_SELECTED_TARGET_NONE,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            0u,
            BODY_CONTROL_SELECTION_POLICY_NONE,
            0.0,
            0u
        );
    }
    atomicAnd(
        &simulations.values[body_id].flags,
        ~(BODY_FLAG_CONTROLLED_THIS_TICK
            | BODY_FLAG_EXTERNAL_MOTION_OWNER_THIS_TICK)
    );
}

@compute @workgroup_size(256)
fn validate_body_control_commands(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        if (global_id.x == 0u) {
            atomicOr(
                &body_control_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    let runtime_capacity = arrayLength(&body_control_program.records);
    if (body_control_program.header.abi_version != BODY_CONTROL_PROGRAM_ABI_VERSION) {
        if (global_id.x == 0u) {
            atomicOr(
                &body_control_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    if (body_control_program.header.capacity != runtime_capacity
        || body_control_program.header.count > runtime_capacity) {
        if (global_id.x == 0u) {
            atomicOr(
                &body_control_program.header.status,
                FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED
            );
        }
        return;
    }
    let command_index = global_id.x;
    if (command_index >= body_control_program.header.count) {
        return;
    }
    let command = body_control_program.records[command_index];
    let body_capacity = arrayLength(&simulations.values);
    let supported_mode = command.mode_flags
            == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
        || command.mode_flags
            == BODY_CONTROL_PROGRAM_MODE_PRIORITY_TARGET_IN_RANGE;
    let output_is_initial = command.result == BODY_CONTROL_RESULT_PENDING
        && command.selected_target_kind == BODY_CONTROL_SELECTED_TARGET_NONE
        && command.selected_target_slot == INVALID_IDENTITY_COMPONENT
        && command.selected_target_entity_id == INVALID_IDENTITY_COMPONENT
        && command.selected_target_incarnation == INVALID_IDENTITY_COMPONENT
        && command.state_flags == 0u;
    let finite_move = all(command.move_intent <= vec2f(3.402823466e+38))
        && all(command.move_intent >= vec2f(-3.402823466e+38));
    let core_payload_structural = command.core_target_slot < body_capacity
        && command.core_target_entity_id != 0u
        && command.core_target_entity_id != INVALID_IDENTITY_COMPONENT
        && command.core_target_incarnation != 0u
        && command.core_target_incarnation != INVALID_IDENTITY_COMPONENT;
    let tower_absent = command.tower_target_slot == INVALID_IDENTITY_COMPONENT
        && command.tower_target_entity_id == INVALID_IDENTITY_COMPONENT
        && command.tower_target_incarnation == INVALID_IDENTITY_COMPONENT;
    let tower_exact = command.tower_target_slot < body_capacity
        && command.tower_target_entity_id != 0u
        && command.tower_target_entity_id != INVALID_IDENTITY_COMPONENT
        && command.tower_target_incarnation != 0u
        && command.tower_target_incarnation != INVALID_IDENTITY_COMPONENT;
    let priority_payload_valid = command.mode_flags
            != BODY_CONTROL_PROGRAM_MODE_PRIORITY_TARGET_IN_RANGE
        || (all(command.move_intent == vec2f(0.0))
            && command.source_tick == params.fixed_tick
            && command.source_tick != 0u
            && command.attack_fingerprint != 0u
            && command.selection_policy
                == BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
            && command.attack_range > 0.0
            && command.attack_range <= 3.402823466e+38
            && core_payload_structural
            && (tower_absent || tower_exact));
    let move_payload_valid = command.mode_flags
            != BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
        || (command.source_tick == 0u
            && command.selection_sequence == 0u
            && command.attack_fingerprint == 0u
            && command.selection_policy == BODY_CONTROL_SELECTION_POLICY_NONE
            && command.attack_range == 0.0
            && command.core_target_slot == INVALID_IDENTITY_COMPONENT
            && command.core_target_entity_id == INVALID_IDENTITY_COMPONENT
            && command.core_target_incarnation == INVALID_IDENTITY_COMPONENT
            && tower_absent
            && dot(command.move_intent, command.move_intent) <= 1.000002);
    if (!supported_mode
        || !output_is_initial
        || !finite_move
        || !priority_payload_valid
        || !move_payload_valid
        || command.reserved_0 != 0u
        || command.destination_slot >= body_capacity) {
        atomicOr(
            &body_control_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    if (command.destination_slot >= counts.body_count
        || simulations.values[command.destination_slot].entity_id
            != command.entity_id
        || simulations.values[command.destination_slot].incarnation
            != command.incarnation) {
        atomicOr(
            &body_control_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    if (command.mode_flags == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
        && body_has_flag(
            load_simulation_flags(command.destination_slot),
            BODY_FLAG_USE_FLOW
        )) {
        atomicOr(
            &body_control_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    // GPU death와 async death-event commit 사이에는 host exact handle이 잠시
    // active일 수 있습니다. 같은 identity의 dead target은 bounded no-op입니다.
    if (!body_id_is_simulation_active(command.destination_slot)) {
        return;
    }
}

@compute @workgroup_size(256)
fn apply_body_control_commands(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || body_control_program.header.abi_version
            != BODY_CONTROL_PROGRAM_ABI_VERSION
        || atomicLoad(&body_control_program.header.status) != 0u
        || body_control_program.header.capacity
            != arrayLength(&body_control_program.records)) {
        return;
    }
    let command_index = global_id.x;
    if (command_index >= body_control_program.header.count) {
        return;
    }
    let command = body_control_program.records[command_index];
    if (!exact_living_body(
        command.destination_slot,
        command.entity_id,
        command.incarnation
    )) {
        let exact_dead_move = command.mode_flags
                == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT
            && command.destination_slot < counts.body_count
            && command.destination_slot < arrayLength(&simulations.values)
            && simulations.values[command.destination_slot].entity_id
                == command.entity_id
            && simulations.values[command.destination_slot].incarnation
                == command.incarnation
            && !body_id_is_alive(command.destination_slot);
        if (exact_dead_move) {
            // GPU death readback 전의 exact MOVE는 ingress PENDING record를
            // 그대로 보존하는 bounded no-op이다.
            return;
        }
        body_control_program.records[command_index].result
            = BODY_CONTROL_RESULT_SOURCE_INVALID;
        return;
    }
    if (command.mode_flags == BODY_CONTROL_PROGRAM_MODE_MOVE_INTENT) {
        store_body_control_state(
            command.destination_slot,
            command,
            BODY_CONTROL_RESULT_PENDING,
            BODY_CONTROL_SELECTED_TARGET_NONE,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            0u
        );
        atomicOr(
            &simulations.values[command.destination_slot].flags,
            BODY_FLAG_CONTROLLED_THIS_TICK
        );
        return;
    }

    if (!exact_living_body(
        command.core_target_slot,
        command.core_target_entity_id,
        command.core_target_incarnation
    )) {
        body_control_program.records[command_index].result
            = BODY_CONTROL_RESULT_CORE_INVALID;
        store_body_control_state(
            command.destination_slot,
            command,
            BODY_CONTROL_RESULT_CORE_INVALID,
            BODY_CONTROL_SELECTED_TARGET_NONE,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            INVALID_IDENTITY_COMPONENT,
            0u
        );
        return;
    }

    var result = BODY_CONTROL_RESULT_NO_TARGET;
    var selected_kind = BODY_CONTROL_SELECTED_TARGET_NONE;
    var selected_slot = INVALID_IDENTITY_COMPONENT;
    var selected_entity_id = INVALID_IDENTITY_COMPONENT;
    var selected_incarnation = INVALID_IDENTITY_COMPONENT;
    var state_flags = BODY_CONTROL_STATE_FLAG_ROUTE_FLOW;
    if (exact_target_is_in_range(
        command.destination_slot,
        command.core_target_slot,
        command.attack_range
    )) {
        result = BODY_CONTROL_RESULT_CORE_SELECTED;
        selected_kind = BODY_CONTROL_SELECTED_TARGET_CORE;
        selected_slot = command.core_target_slot;
        selected_entity_id = command.core_target_entity_id;
        selected_incarnation = command.core_target_incarnation;
        state_flags = BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_CORE_SELECTED;
    } else {
        var tower_slot = command.tower_target_slot;
        var tower_entity_id = command.tower_target_entity_id;
        var tower_incarnation = command.tower_target_incarnation;
        if (tower_target_query_is_valid(command.destination_slot)) {
            let query = tower_target_queries.values[command.destination_slot];
            tower_slot = query.target_slot;
            tower_entity_id = query.target_entity_id;
            tower_incarnation = query.target_incarnation;
        }
        if (exact_living_body(
                tower_slot,
                tower_entity_id,
                tower_incarnation
            ) && exact_target_is_in_range(
                command.destination_slot,
                tower_slot,
                command.attack_range
            )) {
            result = BODY_CONTROL_RESULT_TOWER_SELECTED;
            selected_kind = BODY_CONTROL_SELECTED_TARGET_TOWER;
            selected_slot = tower_slot;
            selected_entity_id = tower_entity_id;
            selected_incarnation = tower_incarnation;
            state_flags = BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED;
        }
    }
    body_control_program.records[command_index].result = result;
    body_control_program.records[command_index].selected_target_kind
        = selected_kind;
    body_control_program.records[command_index].selected_target_slot
        = selected_slot;
    body_control_program.records[command_index].selected_target_entity_id
        = selected_entity_id;
    body_control_program.records[command_index].selected_target_incarnation
        = selected_incarnation;
    body_control_program.records[command_index].state_flags = state_flags;
    store_body_control_state(
        command.destination_slot,
        command,
        result,
        selected_kind,
        selected_slot,
        selected_entity_id,
        selected_incarnation,
        state_flags
    );
    if ((state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
        physics.values[command.destination_slot].velocity = vec2f(0.0);
        atomicOr(
            &simulations.values[command.destination_slot].flags,
            BODY_FLAG_CONTROLLED_THIS_TICK
        );
    }
}

@compute @workgroup_size(256)
fn apply_controlled_motion(@builtin(global_invocation_id) global_id: vec3u) {
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
    if (control_state.source_tick != 0u) {
        if ((control_state.state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
            let selected_target_still_in_range = exact_living_body(
                    control_state.selected_target_slot,
                    control_state.selected_target_entity_id,
                    control_state.selected_target_incarnation
                ) && exact_target_is_in_range(
                    body_id,
                    control_state.selected_target_slot,
                    control_state.attack_range
                );
            if (selected_target_still_in_range) {
                physics.values[body_id].velocity = vec2f(0.0);
                atomicOr(
                    &simulations.values[body_id].flags,
                    BODY_FLAG_CONTROLLED_THIS_TICK
                );
                return;
            }
            body_control_states.values[body_id].result
                = BODY_CONTROL_RESULT_NO_TARGET;
            body_control_states.values[body_id].selected_target_kind
                = BODY_CONTROL_SELECTED_TARGET_NONE;
            body_control_states.values[body_id].selected_target_slot
                = INVALID_IDENTITY_COMPONENT;
            body_control_states.values[body_id].selected_target_entity_id
                = INVALID_IDENTITY_COMPONENT;
            body_control_states.values[body_id].selected_target_incarnation
                = INVALID_IDENTITY_COMPONENT;
            body_control_states.values[body_id].state_flags
                = BODY_CONTROL_STATE_FLAG_ROUTE_FLOW;
        }
        return;
    }
    if ((control_state.state_flags & BODY_CONTROL_STATE_FLAG_STOP) != 0u) {
        physics.values[body_id].velocity = vec2f(0.0);
        return;
    }
    var velocity = physics.values[body_id].velocity;
    let decay = exp(-CONTROL_LINEAR_FRICTION * params.dt);
    let acceleration_scale = (1.0 - decay) / CONTROL_LINEAR_FRICTION;
    velocity = (velocity * decay)
        + (control_state.move_intent
            * CONTROL_ACCELERATION
            * acceleration_scale);
    let controlled_speed = length(velocity);
    if (controlled_speed > CONTROL_MAX_LINEAR_SPEED) {
        velocity = (velocity / controlled_speed) * CONTROL_MAX_LINEAR_SPEED;
    }
    if (control_state.move_intent.x == 0.0
        && control_state.move_intent.y == 0.0
        && length(velocity) <= CONTROL_SLEEP_SPEED) {
        velocity = vec2f(0.0);
    }
    physics.values[body_id].velocity = velocity;
}

@compute @workgroup_size(256)
fn validate_source_relative_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED
            );
        }
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let program = spawn_program.records[program_index];
    let supported_mode = program.mode_flags
            == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_VELOCITY
        || program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT
        || program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        || program.mode_flags
            == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;
    let finite_payload = all(program.position_offset <= vec2f(3.402823466e+38))
        && all(program.position_offset >= vec2f(-3.402823466e+38))
        && all(program.target_offset <= vec2f(3.402823466e+38))
        && all(program.target_offset >= vec2f(-3.402823466e+38))
        && all(program.vector <= vec2f(3.402823466e+38))
        && all(program.vector >= vec2f(-3.402823466e+38))
        && program.scalar <= 3.402823466e+38
        && program.scalar >= -3.402823466e+38;
    let target_mode = program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY;
    let selected_target_mode = program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET;
    let query_no_target = target_mode
        && program.request_flags == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL
        && program.result == SPAWN_PROGRAM_RESULT_NO_TARGET
        && program.target_slot == INVALID_IDENTITY_COMPONENT
        && program.target_entity_id == INVALID_IDENTITY_COMPONENT
        && program.target_incarnation == INVALID_IDENTITY_COMPONENT;
    // Legacy modes 1-3 keep their pre-control tick-start resolve. Mode 4 is
    // validated only by the post-priority-control entrypoint below.
    if (selected_target_mode) {
        return;
    }
    let non_target_payload_valid = target_mode || selected_target_mode
        || (program.target_slot == INVALID_IDENTITY_COMPONENT
            && program.target_entity_id == INVALID_IDENTITY_COMPONENT
            && program.target_incarnation == INVALID_IDENTITY_COMPONENT
            && all(program.target_offset == vec2f(0.0)));
    let target_payload_valid = !target_mode || query_no_target
        || (program.target_slot < body_capacity
            && program.target_entity_id != INVALID_IDENTITY_COMPONENT
            && program.target_incarnation != INVALID_IDENTITY_COMPONENT
            && all(program.vector == vec2f(0.0)));
    let selected_payload_valid = !selected_target_mode
        || (program.source_slot < body_capacity
            && program.target_slot == INVALID_IDENTITY_COMPONENT
            && program.target_entity_id == INVALID_IDENTITY_COMPONENT
            && program.target_incarnation == INVALID_IDENTITY_COMPONENT
            && all(program.vector == vec2f(0.0))
            && program.attack_fingerprint != 0u
            && program.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_NONE
            && program.request_flags
                == SPAWN_PROGRAM_REQUEST_REQUIRE_EXACT_SELECTED_TARGET);
    let legacy_request_flags_valid = program.request_flags == 0u
        || (target_mode
            && program.request_flags
                == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL);
    let legacy_selection_payload_valid = selected_target_mode
        || (program.selection_sequence == 0u
            && program.attack_fingerprint == 0u
            && program.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_NONE
            && legacy_request_flags_valid);
    let selected_destination_config_valid = !selected_target_mode
        || (program.destination_slot < body_capacity
            && enemy_behavior_states.values[program.destination_slot].program_id
                == ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
            && bitcast<i32>(enemy_behavior_states.values[program.destination_slot]
                .windup_range) > 0
            && atomicLoad(&enemy_behavior_states.values[program.destination_slot].state)
                == BODY_CONTROL_SELECTED_TARGET_NONE
            && enemy_behavior_states.values[program.destination_slot].target_slot
                == INVALID_IDENTITY_COMPONENT
            && enemy_behavior_states.values[program.destination_slot].target_entity_id
                == INVALID_IDENTITY_COMPONENT
            && enemy_behavior_states.values[program.destination_slot].target_incarnation
                == INVALID_IDENTITY_COMPONENT);
    if ((program.result != SPAWN_PROGRAM_RESULT_PENDING && !query_no_target)
        || !supported_mode
        || !finite_payload
        || !non_target_payload_valid
        || !target_payload_valid
        || !selected_payload_valid
        || !legacy_selection_payload_valid
        || !selected_destination_config_valid
        || ((program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT
                || target_mode
                || selected_target_mode)
            && !(program.scalar > 0.0))
        || program.source_tick == 0u
        || program.source_tick != params.fixed_tick
        || program.reserved_0 != 0u
        || program.destination_slot >= counts.body_count
        || program.destination_slot >= body_capacity
        || program.source_slot >= body_capacity
        || program.destination_slot == program.source_slot
        || simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)) {
        atomicOr(
            &spawn_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
}

@compute @workgroup_size(256)
fn validate_selected_target_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_ABI_MISMATCH
            );
        }
        return;
    }
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        if (global_id.x == 0u) {
            atomicOr(
                &spawn_program.header.status,
                FIXED_PROGRAM_STATUS_CAPACITY_EXCEEDED
            );
        }
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let program = spawn_program.records[program_index];
    if (program.mode_flags
        != SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let finite_payload = all(program.position_offset <= vec2f(3.402823466e+38))
        && all(program.position_offset >= vec2f(-3.402823466e+38))
        && all(program.target_offset <= vec2f(3.402823466e+38))
        && all(program.target_offset >= vec2f(-3.402823466e+38))
        && all(program.vector <= vec2f(3.402823466e+38))
        && all(program.vector >= vec2f(-3.402823466e+38))
        && program.scalar <= 3.402823466e+38
        && program.scalar >= -3.402823466e+38;
    let slots_in_bounds = program.destination_slot < body_capacity
        && program.source_slot < body_capacity;
    if (program.result != SPAWN_PROGRAM_RESULT_PENDING
        || !finite_payload
        || !slots_in_bounds
        || program.target_slot != INVALID_IDENTITY_COMPONENT
        || program.target_entity_id != INVALID_IDENTITY_COMPONENT
        || program.target_incarnation != INVALID_IDENTITY_COMPONENT
        || any(program.vector != vec2f(0.0))
        || !(program.scalar > 0.0)
        || program.source_tick == 0u
        || program.source_tick != params.fixed_tick
        || program.attack_fingerprint == 0u
        || program.selected_target_kind != BODY_CONTROL_SELECTED_TARGET_NONE
        || program.request_flags
            != SPAWN_PROGRAM_REQUEST_REQUIRE_EXACT_SELECTED_TARGET
        || program.reserved_0 != 0u
        || program.destination_slot >= counts.body_count
        || program.destination_slot == program.source_slot) {
        atomicOr(
            &spawn_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
    // Bounds를 확인한 뒤에만 destination side-plane을 읽습니다.
    if (simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)
        || enemy_behavior_states.values[program.destination_slot].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
        || bitcast<i32>(enemy_behavior_states.values[program.destination_slot]
            .windup_range) <= 0
        || atomicLoad(&enemy_behavior_states.values[program.destination_slot].state)
            != BODY_CONTROL_SELECTED_TARGET_NONE
        || enemy_behavior_states.values[program.destination_slot].target_slot
            != INVALID_IDENTITY_COMPONENT
        || enemy_behavior_states.values[program.destination_slot].target_entity_id
            != INVALID_IDENTITY_COMPONENT
        || enemy_behavior_states.values[program.destination_slot].target_incarnation
            != INVALID_IDENTITY_COMPONENT) {
        atomicOr(
            &spawn_program.header.status,
            FIXED_PROGRAM_STATUS_RECORD_INVALID
        );
        return;
    }
}

@compute @workgroup_size(256)
fn resolve_source_relative_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION
        || atomicLoad(&spawn_program.header.status) != 0u) {
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let program = spawn_program.records[program_index];
    // Mode 4 is resolved only after the same-tick priority control state exists.
    if (program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        return;
    }
    if (program.destination_slot >= counts.body_count
        || program.destination_slot >= body_capacity
        || simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_DESTINATION_INVALID;
        return;
    }
    if (program.source_slot >= body_capacity
        || simulations.values[program.source_slot].entity_id != program.source_entity_id
        || simulations.values[program.source_slot].incarnation
            != program.source_incarnation
        || !body_id_is_simulation_active(program.source_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_SOURCE_INVALID;
        return;
    }
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        && program.request_flags == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL
        && program.result == SPAWN_PROGRAM_RESULT_NO_TARGET) {
        // The query pass uses NO_TARGET as an internal empty-roster marker.
        // Legacy target-entity completion uses TARGET_INVALID for a cancelled
        // shot, including GPU death before the host observes that death.
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_TARGET_INVALID;
        return;
    }
    if (program.mode_flags
        == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        let control_state = body_control_states.values[program.source_slot];
        if (control_state.entity_id != program.source_entity_id
            || control_state.incarnation != program.source_incarnation
            || control_state.source_tick != program.source_tick
            || control_state.selection_sequence != program.selection_sequence
            || control_state.attack_fingerprint != program.attack_fingerprint
            || control_state.selection_policy
                != BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
            || control_state.reserved_0 != 0u) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
            return;
        }
        if (control_state.result == BODY_CONTROL_RESULT_CORE_INVALID) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID;
            return;
        }
        if (control_state.result == BODY_CONTROL_RESULT_NO_TARGET) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_NO_TARGET;
            return;
        }
        let selected_is_core = control_state.result
                == BODY_CONTROL_RESULT_CORE_SELECTED
            && control_state.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_CORE
            && (control_state.state_flags & (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
            )) == (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
            );
        let selected_is_tower = control_state.result
                == BODY_CONTROL_RESULT_TOWER_SELECTED
            && control_state.selected_target_kind
                == BODY_CONTROL_SELECTED_TARGET_TOWER
            && (control_state.state_flags & (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
            )) == (
                BODY_CONTROL_STATE_FLAG_STOP
                | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
            );
        if (!selected_is_core && !selected_is_tower) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
            return;
        }
        if (!exact_living_body(
            control_state.selected_target_slot,
            control_state.selected_target_entity_id,
            control_state.selected_target_incarnation
        )) {
            spawn_program.records[program_index].result = select(
                SPAWN_PROGRAM_RESULT_NO_TARGET,
                SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID,
                selected_is_core
            );
            return;
        }
        let core_damage_fixed_point = bitcast<i32>(
            enemy_behavior_states.values[program.destination_slot].windup_range
        );
        if (enemy_behavior_states.values[program.destination_slot].program_id
                != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
            || core_damage_fixed_point <= 0
            || body_interaction_layer(
                physics.values[program.destination_slot].interaction_meta
            ) != BODY_LAYER_PROJECTILE) {
            spawn_program.records[program_index].result
                = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
            return;
        }

        let source_physics = physics.values[program.source_slot];
        let target_physics = physics.values[control_state.selected_target_slot];
        let destination_position = source_physics.position + program.position_offset;
        var launch_direction = (target_physics.position + program.target_offset)
            - destination_position;
        var launch_direction_length_squared = dot(launch_direction, launch_direction);
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = source_physics.velocity;
            launch_direction_length_squared = dot(launch_direction, launch_direction);
        }
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = vec2f(1.0, 0.0);
        } else {
            launch_direction *= inverseSqrt(launch_direction_length_squared);
        }
        let destination_velocity = launch_direction * program.scalar;
        physics.values[program.destination_slot].position = destination_position;
        physics.values[program.destination_slot].velocity = destination_velocity;
        let selected_interaction_layer = select(
            BODY_LAYER_PLAYER_DAMAGEABLE,
            BODY_LAYER_CORE_PROXY,
            selected_is_core
        );
        let destination_interaction_layer = body_interaction_layer(
            physics.values[program.destination_slot].interaction_meta
        );
        physics.values[program.destination_slot].interaction_meta
            = destination_interaction_layer
                | ((BODY_LAYER_TERRAIN | selected_interaction_layer) << 16u);
        combat_states.values[program.destination_slot]
            .target_interaction_layer_mask = selected_interaction_layer;
        temporaries.values[program.destination_slot].previous_position
            = destination_position;
        temporaries.values[program.destination_slot].predicted_position
            = destination_position;
        temporaries.values[program.destination_slot].position_delta = vec2f(0.0);
        temporaries.values[program.destination_slot].grid_index = -1;
        temporaries.values[program.destination_slot].previous_flow_field_index
            = simulations.values[program.destination_slot].flow_field_index;
        atomicStore(
            &enemy_behavior_states.values[program.destination_slot].state,
            control_state.selected_target_kind
        );
        enemy_behavior_states.values[program.destination_slot]
            .state_entered_fixed_tick = program.source_tick;
        enemy_behavior_states.values[program.destination_slot]
            .state_expires_at_fixed_tick = program.selection_sequence;
        enemy_behavior_states.values[program.destination_slot].target_slot
            = control_state.selected_target_slot;
        enemy_behavior_states.values[program.destination_slot].target_entity_id
            = control_state.selected_target_entity_id;
        enemy_behavior_states.values[program.destination_slot].target_incarnation
            = control_state.selected_target_incarnation;
        atomicStore(
            &enemy_behavior_states.values[program.destination_slot].flags,
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
                | select(
                    ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER,
                    ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE,
                    selected_is_core
                )
        );
        enemy_behavior_states.values[program.destination_slot].charge_direction.x
            = bitcast<f32>(program.attack_fingerprint);
        enemy_behavior_states.values[program.destination_slot].charge_direction.y = 0.0;
        spawn_program.records[program_index].target_slot
            = control_state.selected_target_slot;
        spawn_program.records[program_index].target_entity_id
            = control_state.selected_target_entity_id;
        spawn_program.records[program_index].target_incarnation
            = control_state.selected_target_incarnation;
        spawn_program.records[program_index].selected_target_kind
            = control_state.selected_target_kind;
        snapshot_projectile_attack_damage(
            program.source_slot,
            program.destination_slot,
            select(
                EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER,
                EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE,
                selected_is_core
            )
        );
        atomicOr(
            &simulations.values[program.destination_slot].flags,
            BODY_FLAG_ALIVE
        );
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_RESOLVED;
        return;
    }
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        && (program.target_slot >= body_capacity
            || simulations.values[program.target_slot].entity_id
                != program.target_entity_id
            || simulations.values[program.target_slot].incarnation
                != program.target_incarnation
            || !body_id_is_alive(program.target_slot))) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_TARGET_INVALID;
        return;
    }

    let source_physics = physics.values[program.source_slot];
    let destination_position = source_physics.position + program.position_offset;
    var destination_velocity = program.vector
        + (source_physics.velocity * program.scalar);
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_AIM_POINT) {
        var launch_direction = program.vector - source_physics.position;
        var launch_direction_length_squared = dot(launch_direction, launch_direction);
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = source_physics.velocity;
            launch_direction_length_squared = dot(launch_direction, launch_direction);
        }
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = vec2f(1.0, 0.0);
        } else {
            launch_direction *= inverseSqrt(launch_direction_length_squared);
        }
        destination_velocity = launch_direction * program.scalar;
    } else if (program.mode_flags
            == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY) {
        let target_physics = physics.values[program.target_slot];
        var launch_direction = (target_physics.position + program.target_offset)
            - source_physics.position;
        var launch_direction_length_squared = dot(launch_direction, launch_direction);
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = source_physics.velocity;
            launch_direction_length_squared = dot(launch_direction, launch_direction);
        }
        if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
            launch_direction = vec2f(1.0, 0.0);
        } else {
            launch_direction *= inverseSqrt(launch_direction_length_squared);
        }
        destination_velocity = launch_direction * program.scalar;
    }
    physics.values[program.destination_slot].position = destination_position;
    physics.values[program.destination_slot].velocity = destination_velocity;
    temporaries.values[program.destination_slot].previous_position
        = destination_position;
    temporaries.values[program.destination_slot].predicted_position
        = destination_position;
    temporaries.values[program.destination_slot].position_delta = vec2f(0.0);
    temporaries.values[program.destination_slot].grid_index = -1;
    temporaries.values[program.destination_slot].previous_flow_field_index
        = simulations.values[program.destination_slot].flow_field_index;
    // Host가 exact Tower roster + projectile channel을 증명한 target-entity
    // request에만 source Boost를 한 번 snapshot합니다. PLAYER_DAMAGEABLE layer
    // 자체는 Tower 권한 증거가 아니며 aim/core/other projectile은 원본 damage를 유지합니다.
    if (program.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY
        && program.request_flags == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL) {
        snapshot_projectile_attack_damage(
            program.source_slot,
            program.destination_slot,
            EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER
        );
    }
    atomicOr(
        &simulations.values[program.destination_slot].flags,
        BODY_FLAG_ALIVE
    );
    spawn_program.records[program_index].result = SPAWN_PROGRAM_RESULT_RESOLVED;
}

@compute @workgroup_size(256)
fn resolve_selected_target_spawns(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()
        || spawn_program.header.abi_version != SPAWN_PROGRAM_ABI_VERSION
        || atomicLoad(&spawn_program.header.status) != 0u) {
        return;
    }
    let runtime_capacity = arrayLength(&spawn_program.records);
    if (spawn_program.header.capacity != runtime_capacity
        || spawn_program.header.count > runtime_capacity) {
        return;
    }
    let program_index = global_id.x;
    if (program_index >= spawn_program.header.count) {
        return;
    }
    let body_capacity = arrayLength(&simulations.values);
    let program = spawn_program.records[program_index];
    if (program.mode_flags
        != SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET) {
        return;
    }
    if (program.destination_slot >= counts.body_count
        || program.destination_slot >= body_capacity
        || simulations.values[program.destination_slot].entity_id
            != program.destination_entity_id
        || simulations.values[program.destination_slot].incarnation
            != program.destination_incarnation
        || body_id_is_alive(program.destination_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_DESTINATION_INVALID;
        return;
    }
    if (program.source_slot >= body_capacity
        || simulations.values[program.source_slot].entity_id != program.source_entity_id
        || simulations.values[program.source_slot].incarnation
            != program.source_incarnation
        || !body_id_is_simulation_active(program.source_slot)) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_SOURCE_INVALID;
        return;
    }

    let control_state = body_control_states.values[program.source_slot];
    if (control_state.entity_id != program.source_entity_id
        || control_state.incarnation != program.source_incarnation
        || control_state.source_tick != program.source_tick
        || control_state.selection_sequence != program.selection_sequence
        || control_state.attack_fingerprint != program.attack_fingerprint
        || control_state.selection_policy
            != BODY_CONTROL_SELECTION_POLICY_CORE_FIRST_IN_RANGE_THEN_TOWER
        || control_state.reserved_0 != 0u) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
        return;
    }
    if (control_state.result == BODY_CONTROL_RESULT_CORE_INVALID) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID;
        return;
    }
    if (control_state.result == BODY_CONTROL_RESULT_NO_TARGET) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_NO_TARGET;
        return;
    }
    let selected_is_core = control_state.result
            == BODY_CONTROL_RESULT_CORE_SELECTED
        && control_state.selected_target_kind
            == BODY_CONTROL_SELECTED_TARGET_CORE
        && (control_state.state_flags & (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
        )) == (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_CORE_SELECTED
        );
    let selected_is_tower = control_state.result
            == BODY_CONTROL_RESULT_TOWER_SELECTED
        && control_state.selected_target_kind
            == BODY_CONTROL_SELECTED_TARGET_TOWER
        && (control_state.state_flags & (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
        )) == (
            BODY_CONTROL_STATE_FLAG_STOP
            | BODY_CONTROL_STATE_FLAG_TOWER_SELECTED
        );
    if (!selected_is_core && !selected_is_tower) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
        return;
    }
    if (!exact_living_body(
        control_state.selected_target_slot,
        control_state.selected_target_entity_id,
        control_state.selected_target_incarnation
    )) {
        spawn_program.records[program_index].result = select(
            SPAWN_PROGRAM_RESULT_NO_TARGET,
            SPAWN_PROGRAM_RESULT_CORE_TARGET_INVALID,
            selected_is_core
        );
        return;
    }
    let core_damage_fixed_point = bitcast<i32>(
        enemy_behavior_states.values[program.destination_slot].windup_range
    );
    if (enemy_behavior_states.values[program.destination_slot].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
        || core_damage_fixed_point <= 0
        || body_interaction_layer(
            physics.values[program.destination_slot].interaction_meta
        ) != BODY_LAYER_PROJECTILE) {
        spawn_program.records[program_index].result
            = SPAWN_PROGRAM_RESULT_CONTROL_STATE_MISMATCH;
        return;
    }

    let source_physics = physics.values[program.source_slot];
    let target_physics = physics.values[control_state.selected_target_slot];
    let destination_position = source_physics.position + program.position_offset;
    var launch_direction = (target_physics.position + program.target_offset)
        - destination_position;
    var launch_direction_length_squared = dot(launch_direction, launch_direction);
    if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
        launch_direction = source_physics.velocity;
        launch_direction_length_squared = dot(launch_direction, launch_direction);
    }
    if (launch_direction_length_squared <= EPSILON_DISTANCE_SQUARED) {
        launch_direction = vec2f(1.0, 0.0);
    } else {
        launch_direction *= inverseSqrt(launch_direction_length_squared);
    }
    let destination_velocity = launch_direction * program.scalar;
    physics.values[program.destination_slot].position = destination_position;
    physics.values[program.destination_slot].velocity = destination_velocity;
    let selected_interaction_layer = select(
        BODY_LAYER_PLAYER_DAMAGEABLE,
        BODY_LAYER_CORE_PROXY,
        selected_is_core
    );
    let destination_interaction_layer = body_interaction_layer(
        physics.values[program.destination_slot].interaction_meta
    );
    physics.values[program.destination_slot].interaction_meta
        = destination_interaction_layer
            | ((BODY_LAYER_TERRAIN | selected_interaction_layer) << 16u);
    combat_states.values[program.destination_slot]
        .target_interaction_layer_mask = selected_interaction_layer;
    temporaries.values[program.destination_slot].previous_position
        = destination_position;
    temporaries.values[program.destination_slot].predicted_position
        = destination_position;
    temporaries.values[program.destination_slot].position_delta = vec2f(0.0);
    temporaries.values[program.destination_slot].grid_index = -1;
    temporaries.values[program.destination_slot].previous_flow_field_index
        = simulations.values[program.destination_slot].flow_field_index;
    atomicStore(
        &enemy_behavior_states.values[program.destination_slot].state,
        control_state.selected_target_kind
    );
    enemy_behavior_states.values[program.destination_slot]
        .state_entered_fixed_tick = program.source_tick;
    enemy_behavior_states.values[program.destination_slot]
        .state_expires_at_fixed_tick = program.selection_sequence;
    enemy_behavior_states.values[program.destination_slot].target_slot
        = control_state.selected_target_slot;
    enemy_behavior_states.values[program.destination_slot].target_entity_id
        = control_state.selected_target_entity_id;
    enemy_behavior_states.values[program.destination_slot].target_incarnation
        = control_state.selected_target_incarnation;
    atomicStore(
        &enemy_behavior_states.values[program.destination_slot].flags,
        ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | select(
                ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER,
                ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE,
                selected_is_core
            )
    );
    enemy_behavior_states.values[program.destination_slot].charge_direction.x
        = bitcast<f32>(program.attack_fingerprint);
    enemy_behavior_states.values[program.destination_slot].charge_direction.y = 0.0;
    spawn_program.records[program_index].target_slot
        = control_state.selected_target_slot;
    spawn_program.records[program_index].target_entity_id
        = control_state.selected_target_entity_id;
    spawn_program.records[program_index].target_incarnation
        = control_state.selected_target_incarnation;
    spawn_program.records[program_index].selected_target_kind
        = control_state.selected_target_kind;
    snapshot_projectile_attack_damage(
        program.source_slot,
        program.destination_slot,
        select(
            EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER,
            EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE,
            selected_is_core
        )
    );
    atomicOr(
        &simulations.values[program.destination_slot].flags,
        BODY_FLAG_ALIVE
    );
    spawn_program.records[program_index].result
        = SPAWN_PROGRAM_RESULT_RESOLVED;
}

`;
