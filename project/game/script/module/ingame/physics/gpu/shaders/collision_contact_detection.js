

export const COLLISION_CONTACT_DETECTION_WGSL = /* wgsl */`struct ContactSelection {
    found: u32,
    distance_squared: f32,
    contact: Contact,
}

fn empty_contact_selection() -> ContactSelection {
    return ContactSelection(
        0u,
        0.0,
        Contact(0u, 0u, -1, 0u, vec2f(0.0), vec2f(0.0))
    );
}

fn contact_handler_has_flag(flags: u32, flag: u32) -> bool {
    return (flags & flag) == flag;
}

fn contact_handler_has_interaction_policy(flags: u32) -> bool {
    let policy = flags & (
        CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        | CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS
    );
    return policy == CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        || policy == CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS;
}

fn interaction_policy_event_type(flags: u32) -> u32 {
    return select(
        APPLIED_EVENT_TYPE_INTERACTION_CONTINUOUS,
        APPLIED_EVENT_TYPE_INTERACTION_ENTER,
        contact_handler_has_flag(
            flags,
            CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        )
    );
}

fn interaction_policy_event_flag(flags: u32) -> u32 {
    return select(
        APPLIED_EVENT_FLAG_CONTINUOUS_POLICY,
        APPLIED_EVENT_FLAG_ENTER_POLICY,
        contact_handler_has_flag(
            flags,
            CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
        )
    );
}

fn append_contact(contact: Contact) {
    let contact_index = atomicAdd(&contact_state.contact_count, 1u);
    if (contact_index >= params.max_contacts) {
        atomicAdd(&contact_state.contact_overflow, 1u);
        return;
    }
    contacts.values[contact_index] = contact;
}

fn mark_core_damage_request_candidate(contact_index: u32) {
    var marker_bits: u32 = CORE_DAMAGE_REQUEST_MARKER_MAGIC;
    contacts.values[contact_index].normal.y
        = bitcast<f32>(marker_bits);
}

fn contact_is_core_damage_request_candidate(contact: Contact) -> bool {
    return (bitcast<u32>(contact.normal.y)
            & CORE_DAMAGE_REQUEST_MARKER_MAGIC_MASK)
        == CORE_DAMAGE_REQUEST_MARKER_MAGIC;
}

fn directional_defense_flat_reduction(contact: Contact) -> i32 {
    if ((bitcast<u32>(contact.normal.y)
            & DIRECTIONAL_DEFENSE_MARKER_MAGIC_MASK)
        != DIRECTIONAL_DEFENSE_MARKER_MAGIC) {
        return 0;
    }
    return max(bitcast<i32>(contact.normal.x), 0);
}

fn directional_defense_marker_payload() -> f32 {
    // NaN payload는 WGSL constant expression에서 representable f32가 아닙니다.
    // Runtime local을 거쳐 bit pattern을 보존합니다.
    var marker_bits: u32 = DIRECTIONAL_DEFENSE_MARKER_MAGIC;
    return bitcast<f32>(marker_bits);
}

fn selected_target_tower_marker_for_policy(policy_event_flag: u32) -> u32 {
    if (policy_event_flag == APPLIED_EVENT_FLAG_ENTER_POLICY) {
        return SELECTED_TARGET_TOWER_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER;
    }
    if (policy_event_flag == APPLIED_EVENT_FLAG_CONTINUOUS_POLICY) {
        return SELECTED_TARGET_TOWER_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS;
    }
    return 0u;
}

fn selected_target_tower_policy_from_marker(marker: u32) -> u32 {
    if ((marker & SELECTED_TARGET_TOWER_MARKER_MAGIC_MASK)
        != SELECTED_TARGET_TOWER_MARKER_MAGIC) {
        return 0u;
    }
    let policy = marker & MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_MASK;
    if (policy == MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER) {
        return APPLIED_EVENT_FLAG_ENTER_POLICY;
    }
    if (policy == MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS) {
        return APPLIED_EVENT_FLAG_CONTINUOUS_POLICY;
    }
    return 0u;
}

fn mark_selected_target_tower_candidate(
    contact_index: u32,
    final_damage: i32,
    policy_event_flag: u32
) {
    contacts.values[contact_index].normal = vec2f(
        bitcast<f32>(final_damage),
        bitcast<f32>(selected_target_tower_marker_for_policy(
            policy_event_flag
        ))
    );
}

fn consider_body_contact(
    self_body: GridBody,
    other_body: GridBody,
    closest_only: bool,
    suppress_previous_overlap: bool,
    selection: ContactSelection
) -> ContactSelection {
    if (self_body.body_id == other_body.body_id
        || !body_id_is_simulation_active(other_body.body_id)) {
        return selection;
    }
    let self_mask = body_interaction_mask(self_body.interaction_meta);
    let self_layer = body_interaction_layer(self_body.interaction_meta);
    let other_mask = body_interaction_mask(other_body.interaction_meta);
    let other_layer = body_interaction_layer(other_body.interaction_meta);
    if ((self_mask & other_layer) == 0u
        || (other_mask & self_layer) == 0u) {
        return selection;
    }

    let delta = other_body.predicted_position - self_body.predicted_position;
    let distance_squared = dot(delta, delta);
    let minimum_distance = body_interaction_radius(self_body)
        + body_interaction_radius(other_body);
    let minimum_distance_squared = minimum_distance * minimum_distance;
    if (distance_squared >= minimum_distance_squared) {
        return selection;
    }

    if (suppress_previous_overlap) {
        let previous_delta = temporaries.values[other_body.body_id].previous_position
            - temporaries.values[self_body.body_id].previous_position;
        if (dot(previous_delta, previous_delta) < minimum_distance_squared) {
            return selection;
        }
    }

    var normal = -deterministic_separation_normal(
        self_body.body_id,
        other_body.body_id
    );
    var distance = 0.0;
    if (distance_squared > EPSILON_DISTANCE_SQUARED) {
        let inverse_distance = inverseSqrt(distance_squared);
        normal = delta * inverse_distance;
        distance = distance_squared * inverse_distance;
    }
    let contact = Contact(
        self_body.body_id,
        simulations.values[self_body.body_id].incarnation,
        i32(other_body.body_id),
        simulations.values[other_body.body_id].incarnation,
        self_body.predicted_position + normal * (distance - other_body.radius),
        normal
    );
    if (!closest_only) {
        append_contact(contact);
        return selection;
    }
    if (selection.found == 0u
        || distance_squared < selection.distance_squared
        || (distance_squared == selection.distance_squared
            && other_body.body_id < u32(selection.contact.other_body_id))) {
        return ContactSelection(1u, distance_squared, contact);
    }
    return selection;
}

fn scan_contact_bucket(
    self_body: GridBody,
    bucket_offset: u32,
    bucket_count: u32,
    closest_only: bool,
    suppress_previous_overlap: bool,
    selection: ContactSelection
) -> ContactSelection {
    var result = selection;
    for (var index = 0u; index < bucket_count; index += 1u) {
        result = consider_body_contact(
            self_body,
            grid_bodies.values[bucket_offset + index],
            closest_only,
            suppress_previous_overlap,
            result
        );
    }
    return result;
}

fn scan_canonical_big_contact_bucket(
    self_body: GridBody,
    cell_index: u32,
    closest_only: bool,
    suppress_previous_overlap: bool,
    selection: ContactSelection
) -> ContactSelection {
    var result = selection;
    let count = min(
        atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
        params.max_bodies_per_cell
    );
    let offset = grid_bucket_offset(cell_index, 1u);
    for (var index = 0u; index < count; index += 1u) {
        let other_body = grid_bodies.values[offset + index];
        let center_cell = vec2i(floor(
            other_body.predicted_position / params.grid_cell_size
        ));
        if (center_cell.x < 0 || center_cell.y < 0
            || center_cell.x >= i32(params.grid_cell_count.x)
            || center_cell.y >= i32(params.grid_cell_count.y)) {
            continue;
        }
        let center_cell_index = u32(center_cell.y) * params.grid_cell_count.x
            + u32(center_cell.x);
        if (center_cell_index != cell_index) {
            continue;
        }
        result = consider_body_contact(
            self_body,
            other_body,
            closest_only,
            suppress_previous_overlap,
            result
        );
    }
    return result;
}

@compute @workgroup_size(1)
fn clear_contact_state() {
    atomicStore(&contact_state.contact_count, 0u);
    atomicStore(&contact_state.contact_overflow, 0u);
    atomicStore(&contact_state.event_count, 0u);
    atomicStore(&contact_state.event_overflow, 0u);
    atomicStore(&contact_state.death_count, 0u);
    atomicStore(&contact_state.death_overflow, 0u);
    atomicStore(&contact_state.maximum_damage_window_event_count, 0u);
    atomicStore(
        &contact_state.maximum_damage_window_protocol_status,
        MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK
    );
    atomicStore(&contact_state.core_damage_request_event_count, 0u);
    atomicStore(
        &contact_state.core_damage_request_protocol_status,
        CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK
    );
    atomicStore(&contact_state.atomic_transform_candidate_count, 0u);
    atomicStore(&contact_state.atomic_transform_event_base, 0u);
    atomicStore(&contact_state.atomic_transform_protocol_status, 0u);
    atomicStore(&contact_state.atomic_transform_committed_count, 0u);
    atomicStore(
        &contact_state.abi_status,
        select(CONTACT_ABI_STATUS_MISMATCH, CONTACT_ABI_STATUS_OK, abi_is_current())
    );
    atomicStore(&contact_state.event_encoding_version, BODY_ABI_VERSION);
}

@compute @workgroup_size(256)
fn clear_enemy_charge_impact_states(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    atomicStore(
        &enemy_charge_impacts.values[body_id].selected_contact_index,
        INVALID_IDENTITY_COMPONENT
    );
    atomicStore(
        &enemy_charge_impacts.values[body_id].status,
        ENEMY_CHARGE_IMPACT_STATUS_EMPTY
    );
    enemy_charge_impacts.values[body_id].captured_fixed_tick = 0u;
    enemy_charge_impacts.values[body_id].arrow_slot = INVALID_IDENTITY_COMPONENT;
    enemy_charge_impacts.values[body_id].tower_slot = INVALID_IDENTITY_COMPONENT;
    enemy_charge_impacts.values[body_id].arrow_entity_id
        = INVALID_IDENTITY_COMPONENT;
    enemy_charge_impacts.values[body_id].arrow_incarnation
        = INVALID_IDENTITY_COMPONENT;
    enemy_charge_impacts.values[body_id].tower_entity_id
        = INVALID_IDENTITY_COMPONENT;
    enemy_charge_impacts.values[body_id].tower_incarnation
        = INVALID_IDENTITY_COMPONENT;
    enemy_charge_impacts.values[body_id].contact_normal = vec2f(0.0);
    enemy_charge_impacts.values[body_id].pre_impact_relative_velocity
        = vec2f(0.0);
    enemy_charge_impacts.values[body_id].arrow_inverse_mass = 0.0;
    enemy_charge_impacts.values[body_id].tower_inverse_mass = 0.0;
    atomicStore(
        &enemy_charge_impacts.values[body_id].velocity_delta_x_fixed_point,
        0
    );
    atomicStore(
        &enemy_charge_impacts.values[body_id].velocity_delta_y_fixed_point,
        0
    );
}

@compute @workgroup_size(256)
fn generate_body_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let self_body_id = global_id.x;
    if (self_body_id >= counts.body_count
        || !body_id_is_simulation_active(self_body_id)) {
        return;
    }
    let self_physics = physics.values[self_body_id];
    let handler_flags = contact_handlers.values[self_body_id].flags;
    if (self_physics.radius <= 0.0
        || body_interaction_mask(self_physics.interaction_meta) == 0u
        || !contact_handler_has_interaction_policy(handler_flags)) {
        return;
    }
    let predicted = temporaries.values[self_body_id].predicted_position;
    let self_body = make_grid_body(self_body_id, predicted);
    let closest_only = contact_handler_has_flag(
        handler_flags,
        CONTACT_HANDLER_FLAG_CLOSEST_ONLY
    );
    let suppress_previous_overlap = contact_handler_has_flag(
        handler_flags,
        CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY
    );
    var selection = empty_contact_selection();

    if (collision_grid_body_uses_small(self_physics.radius)) {
        let center = vec2i(floor(predicted / params.grid_cell_size));
        if (center.x < 0 || center.y < 0
            || center.x >= i32(params.grid_cell_count.x)
            || center.y >= i32(params.grid_cell_count.y)) {
            return;
        }
        for (var neighbor_index = 0u; neighbor_index < 9u; neighbor_index += 1u) {
            let neighbor = center + NEIGHBOR_OFFSETS[neighbor_index];
            if (neighbor.x < 0 || neighbor.y < 0
                || neighbor.x >= i32(params.grid_cell_count.x)
                || neighbor.y >= i32(params.grid_cell_count.y)) {
                continue;
            }
            let cell_index = u32(neighbor.y) * params.grid_cell_count.x
                + u32(neighbor.x);
            let count = min(
                atomicLoad(&grid_counts.values[cell_index * 2u]),
                params.max_bodies_per_cell
            );
            selection = scan_contact_bucket(
                self_body,
                grid_bucket_offset(cell_index, 0u),
                count,
                closest_only,
                suppress_previous_overlap,
                selection
            );
        }
        let center_index = u32(center.y) * params.grid_cell_count.x + u32(center.x);
        let big_count = min(
            atomicLoad(&grid_counts.values[(center_index * 2u) + 1u]),
            params.max_bodies_per_cell
        );
        selection = scan_contact_bucket(
            self_body,
            grid_bucket_offset(center_index, 1u),
            big_count,
            closest_only,
            suppress_previous_overlap,
            selection
        );
    } else {
        let interaction_radius = self_physics.radius
            + max(params.maximum_body_radius, 0.0);
        let raw_min = vec2i(floor(
            (predicted - vec2f(interaction_radius)) / params.grid_cell_size
        ));
        let raw_max = vec2i(floor(
            (predicted + vec2f(interaction_radius)) / params.grid_cell_size
        ));
        if (raw_max.x < 0 || raw_max.y < 0
            || raw_min.x >= i32(params.grid_cell_count.x)
            || raw_min.y >= i32(params.grid_cell_count.y)) {
            return;
        }
        let maximum_cell = vec2i(params.grid_cell_count) - vec2i(1);
        let minimum_covered = clamp(raw_min, vec2i(0), maximum_cell);
        let maximum_covered = clamp(raw_max, vec2i(0), maximum_cell);
        for (var y = minimum_covered.y; y <= maximum_covered.y; y += 1) {
            for (var x = minimum_covered.x; x <= maximum_covered.x; x += 1) {
                let cell_index = u32(y) * params.grid_cell_count.x + u32(x);
                let small_count = min(
                    atomicLoad(&grid_counts.values[cell_index * 2u]),
                    params.max_bodies_per_cell
                );
                selection = scan_contact_bucket(
                    self_body,
                    grid_bucket_offset(cell_index, 0u),
                    small_count,
                    closest_only,
                    suppress_previous_overlap,
                    selection
                );
                selection = scan_canonical_big_contact_bucket(
                    self_body,
                    cell_index,
                    closest_only,
                    suppress_previous_overlap,
                    selection
                );
            }
        }
    }
    if (closest_only && selection.found != 0u) {
        append_contact(selection.contact);
    }
}

fn sdf_value_at(texel: vec2i) -> f32 {
    let clamped = clamp(texel, vec2i(0), vec2i(params.sdf_size) - vec2i(1));
    let index = (u32(clamped.y) * params.sdf_size.x) + u32(clamped.x);
    return sdf_values.values[index];
}

fn sample_terrain_sdf(world_position: vec2f) -> f32 {
    let uv = world_position / params.world_size;
    let coordinate = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(params.sdf_size)
        - vec2f(0.5);
    let base = vec2i(floor(coordinate));
    let fraction = fract(coordinate);
    let top = mix(sdf_value_at(base), sdf_value_at(base + vec2i(1, 0)), fraction.x);
    let bottom = mix(
        sdf_value_at(base + vec2i(0, 1)),
        sdf_value_at(base + vec2i(1, 1)),
        fraction.x
    );
    return mix(top, bottom, fraction.y);
}

fn world_boundary_sdf(world_position: vec2f) -> f32 {
    let half_size = params.world_size * 0.5;
    let box_delta = abs(world_position - half_size) - half_size;
    let outside_distance = length(max(box_delta, vec2f(0.0)));
    let inside_distance = min(max(box_delta.x, box_delta.y), 0.0);
    return -(outside_distance + inside_distance);
}

fn sample_world_sdf(world_position: vec2f) -> f32 {
    return min(
        sample_terrain_sdf(world_position),
        world_boundary_sdf(world_position)
    );
}

fn world_contact_normal(body_id: u32, predicted: vec2f) -> vec2f {
    let gradient_step = max(params.source_world_unit_scale, 0.0001);
    var normal = vec2f(
        sample_world_sdf(predicted + vec2f(gradient_step, 0.0))
            - sample_world_sdf(predicted - vec2f(gradient_step, 0.0)),
        sample_world_sdf(predicted + vec2f(0.0, gradient_step))
            - sample_world_sdf(predicted - vec2f(0.0, gradient_step))
    );
    let normal_length = length(normal);
    if (normal_length >= EPSILON_MASS) {
        return normal / normal_length;
    }
    let center_delta = (params.world_size * 0.5) - predicted;
    let center_distance = length(center_delta);
    if (center_distance >= EPSILON_MASS) {
        return center_delta / center_distance;
    }
    let entity_id = simulations.values[body_id].entity_id;
    return select(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), (entity_id & 1u) == 0u);
}

@compute @workgroup_size(256)
fn generate_world_contacts(@builtin(global_invocation_id) global_id: vec3u) {
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
    let simulation_flags = load_simulation_flags(body_id);
    if ((body_interaction_mask(body.interaction_meta) & BODY_LAYER_TERRAIN) == 0u
        || ((simulation_flags & (
            BODY_FLAG_INTERACTION_ENTER_ONLY
            | BODY_FLAG_INTERACTION_CONTINUOUS
        )) == 0u)) {
        return;
    }
    let predicted = temporaries.values[body_id].predicted_position;
    let previous = temporaries.values[body_id].previous_position;
    let penetration = body.radius - sample_world_sdf(predicted);
    let previous_penetration = body.radius - sample_world_sdf(previous);
    let suppress_previous_overlap = (
        simulation_flags & BODY_FLAG_INTERACTION_ENTER_ONLY
    ) != 0u;
    if (penetration <= 0.0
        || (suppress_previous_overlap && previous_penetration > 0.0)) {
        return;
    }
    let normal = world_contact_normal(body_id, predicted);
    append_contact(Contact(
        body_id,
        simulations.values[body_id].incarnation,
        -1,
        0u,
        predicted + normal * penetration,
        normal
    ));
}

fn enemy_charge_contact_matches_bound_tower(contact: Contact) -> bool {
    if (contact.other_body_id < 0) {
        return false;
    }
    let arrow_slot = contact.self_body_id;
    let tower_slot = u32(contact.other_body_id);
    return arrow_slot < counts.body_count
        && tower_slot < counts.body_count
        && arrow_slot != tower_slot
        && enemy_behavior_states.values[arrow_slot].program_id
            == ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        && simulations.values[arrow_slot].incarnation == contact.self_incarnation
        && simulations.values[tower_slot].incarnation == contact.other_incarnation
        && body_id_is_simulation_active(arrow_slot)
        && body_id_is_simulation_active(tower_slot)
        && behavior_target_matches_gameplay_tower(arrow_slot)
        && tower_slot == enemy_behavior_states.values[arrow_slot].target_slot
        && simulations.values[tower_slot].entity_id
            == enemy_behavior_states.values[arrow_slot].target_entity_id
        && contact.other_incarnation
            == enemy_behavior_states.values[arrow_slot].target_incarnation
        && body_interaction_layer(
            physics.values[tower_slot].interaction_meta
        ) == BODY_LAYER_PLAYER_DAMAGEABLE;
}

@compute @workgroup_size(256)
fn select_enemy_charge_impact_contacts(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    if (!enemy_charge_contact_matches_bound_tower(contact)
        || atomicLoad(
            &enemy_behavior_states.values[contact.self_body_id].state
        ) != ENEMY_BEHAVIOR_STATE_CHARGE) {
        return;
    }
    // Contact append 순서와 invocation scheduling에 관계없이 이 Arrow의
    // canonical contact index 하나만 선택합니다. 동일 identity의 duplicate는
    // 다음 materialize/shield 단계에서 publication되지 않습니다.
    atomicMin(
        &enemy_charge_impacts.values[contact.self_body_id]
            .selected_contact_index,
        contact_index
    );
}

@compute @workgroup_size(256)
fn materialize_enemy_charge_impact_evidence(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let arrow_slot = global_id.x;
    if (arrow_slot >= counts.body_count) {
        return;
    }
    let contact_index = atomicLoad(
        &enemy_charge_impacts.values[arrow_slot].selected_contact_index
    );
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    if (contact.self_body_id != arrow_slot
        || !enemy_charge_contact_matches_bound_tower(contact)
        || atomicLoad(&enemy_behavior_states.values[arrow_slot].state)
            != ENEMY_BEHAVIOR_STATE_CHARGE) {
        return;
    }
    let contact_normal_length_squared = dot(contact.normal, contact.normal);
    if (contact_normal_length_squared <= EPSILON_DISTANCE_SQUARED) {
        return;
    }
    let tower_slot = u32(contact.other_body_id);
    // handle/classifier가 contact.normal을 marker로 바꾸기 전에 실제 normal과
    // pre-impact relative velocity를 이 transient plane에 보존합니다.
    let tower_to_arrow_normal = -contact.normal
        * inverseSqrt(contact_normal_length_squared);
    let relative_velocity = physics.values[arrow_slot].velocity
        - physics.values[tower_slot].velocity;
    enemy_charge_impacts.values[arrow_slot].captured_fixed_tick
        = params.fixed_tick;
    enemy_charge_impacts.values[arrow_slot].arrow_slot = arrow_slot;
    enemy_charge_impacts.values[arrow_slot].tower_slot = tower_slot;
    enemy_charge_impacts.values[arrow_slot].arrow_entity_id
        = simulations.values[arrow_slot].entity_id;
    enemy_charge_impacts.values[arrow_slot].arrow_incarnation
        = contact.self_incarnation;
    enemy_charge_impacts.values[arrow_slot].tower_entity_id
        = simulations.values[tower_slot].entity_id;
    enemy_charge_impacts.values[arrow_slot].tower_incarnation
        = contact.other_incarnation;
    enemy_charge_impacts.values[arrow_slot].contact_normal
        = tower_to_arrow_normal;
    enemy_charge_impacts.values[arrow_slot].pre_impact_relative_velocity
        = relative_velocity;
    enemy_charge_impacts.values[arrow_slot].arrow_inverse_mass
        = max(physics.values[arrow_slot].inverse_mass, 0.0);
    enemy_charge_impacts.values[arrow_slot].tower_inverse_mass
        = max(physics.values[tower_slot].inverse_mass, 0.0);
    atomicStore(
        &enemy_charge_impacts.values[arrow_slot].status,
        ENEMY_CHARGE_IMPACT_STATUS_CAPTURED
    );
}

@compute @workgroup_size(256)
fn classify_directional_defense_contacts(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    if (contact.other_body_id < 0) {
        return;
    }
    let source_body_id = contact.self_body_id;
    let target_body_id = u32(contact.other_body_id);
    if (source_body_id >= counts.body_count
        || target_body_id >= counts.body_count
        || source_body_id == target_body_id) {
        return;
    }
    let source_entity_id = simulations.values[source_body_id].entity_id;
    let source_incarnation = simulations.values[source_body_id].incarnation;
    let target_entity_id = simulations.values[target_body_id].entity_id;
    let target_incarnation = simulations.values[target_body_id].incarnation;
    if (source_entity_id == 0u
        || source_entity_id == INVALID_IDENTITY_COMPONENT
        || source_incarnation == 0u
        || source_incarnation == INVALID_IDENTITY_COMPONENT
        || target_entity_id == 0u
        || target_entity_id == INVALID_IDENTITY_COMPONENT
        || target_incarnation == 0u
        || target_incarnation == INVALID_IDENTITY_COMPONENT
        || source_incarnation != contact.self_incarnation
        || target_incarnation != contact.other_incarnation
        || !body_id_is_simulation_active(source_body_id)
        || !body_id_is_simulation_active(target_body_id)
        || enemy_behavior_states.values[target_body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT
        || atomicLoad(&enemy_behavior_states.values[target_body_id].state)
            != ENEMY_BEHAVIOR_STATE_ORBIT_TOWER
        || !octagon_orbit_config_is_valid(target_body_id)
        || !behavior_target_matches_gameplay_tower(target_body_id)) {
        return;
    }
    let target_flags = atomicLoad(
        &enemy_behavior_states.values[target_body_id].flags
    );
    if ((target_flags & (
            ENEMY_BEHAVIOR_FLAG_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE
        )) != (
            ENEMY_BEHAVIOR_FLAG_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE
        )) {
        return;
    }
    // Contact generation substitutes an identity-derived unit normal for an exact
    // center overlap. Directional defense must instead honor the authored
    // zero-direction policy from the same predicted positions used by the grid.
    let incoming_delta = temporaries.values[source_body_id].predicted_position
        - temporaries.values[target_body_id].predicted_position;
    let incoming_distance_squared = dot(incoming_delta, incoming_delta);
    let facing = enemy_behavior_states.values[target_body_id].charge_direction;
    let facing_length_squared = dot(facing, facing);
    if (incoming_distance_squared <= EPSILON_DISTANCE_SQUARED
        || facing_length_squared <= EPSILON_DISTANCE_SQUARED) {
        return;
    }
    let incoming_direction = incoming_delta
        * inverseSqrt(incoming_distance_squared);
    let target_facing = facing * inverseSqrt(facing_length_squared);
    let facet_config = enemy_behavior_states.values[target_body_id]
        .telegraph_color_rgba8;
    let armored_facet_count = facet_config & 65535u;
    let total_facet_count = (facet_config >> 16u) & 65535u;
    let armored_half_angle = 3.141592653589793
        * f32(armored_facet_count)
        / f32(total_facet_count);
    if (dot(target_facing, incoming_direction) < cos(armored_half_angle)) {
        return;
    }
    let flat_reduction = bitcast<i32>(
        enemy_behavior_states.values[target_body_id].telegraph_style_code
    );
    contacts.values[contact_index].normal = vec2f(
        bitcast<f32>(flat_reduction),
        directional_defense_marker_payload()
    );
}

`;
