

export const COLLISION_CONTACT_RESOLUTION_WGSL = /* wgsl */`@compute @workgroup_size(256)
fn handle_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    // clear_contact_state가 같은 pass 앞에서 BODY ABI를 한 번 검증합니다. 여기서는
    // 그 sticky 결과를 소비해 contact ABI storage usage를 9로 유지합니다.
    if (atomicLoad(&contact_state.abi_status) != CONTACT_ABI_STATUS_OK) {
        return;
    }
    if (atomicLoad(&contact_state.contact_overflow) != 0u) {
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
    let atomic_transform_marker = bitcast<u32>(contact.normal.y);
    if (atomic_transform_marker == ATOMIC_TRANSFORM_FIRST_HIT_MARKER_WINNER
        || atomic_transform_marker == ATOMIC_TRANSFORM_FIRST_HIT_MARKER_SHIELD
        || atomic_transform_marker == PROJECTILE_CAPTURE_PREPARED_SHIELD
        || atomic_transform_marker == ENEMY_CHARGE_DISARMED_SHIELD) {
        return;
    }
    let self_body_id = contact.self_body_id;
    let body_capacity = arrayLength(&simulations.values);
    if (self_body_id >= body_capacity
        || simulations.values[self_body_id].incarnation != contact.self_incarnation
        || !body_id_is_simulation_active(self_body_id)) {
        return;
    }
    let handler = contact_handlers.values[self_body_id];
    if (!contact_handler_has_interaction_policy(handler.flags)) {
        return;
    }
    let policy_event_type = interaction_policy_event_type(handler.flags);
    let policy_event_flag = interaction_policy_event_flag(handler.flags);

    if (contact.other_body_id < 0) {
        if (contact.other_body_id != -1) {
            return;
        }
        let kill_on_terrain = contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_KILL_IF_OTHER_TERRAIN
        );
        if (kill_on_terrain && !clear_alive_once(self_body_id)) {
            return;
        }
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            0u,
            0u,
            0,
            policy_event_type
                | policy_event_flag
                | APPLIED_EVENT_FLAG_TERRAIN_CONTACT
                | select(0u, APPLIED_EVENT_FLAG_TERRAIN_KILL, kill_on_terrain),
            contact.world_position
        ));
        if (kill_on_terrain) {
            append_death_event(self_body_id, DEATH_EVENT_FLAG_HEALTH);
        }
        return;
    }

    let other_body_id = u32(contact.other_body_id);
    if (other_body_id >= body_capacity
        || other_body_id == self_body_id
        || simulations.values[other_body_id].incarnation != contact.other_incarnation
        || !body_id_is_simulation_active(other_body_id)) {
        return;
    }
    if (body_interaction_layer(physics.values[self_body_id].interaction_meta)
            == BODY_LAYER_CORE_PROXY
        && ((body_interaction_layer(
                physics.values[other_body_id].interaction_meta
            ) == BODY_LAYER_PROJECTILE
            && contact_handler_has_flag(
                contact_handlers.values[other_body_id].flags,
                CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
            )) || hostile_direct_core_impact_is_valid(
                other_body_id,
                self_body_id
            ))) {
        // Hostile source 방향의 typed request만 Core damage authority를 갖습니다.
        return;
    }
    if (hostile_direct_core_impact_is_valid(self_body_id, other_body_id)) {
        // Effect summary가 필요한 Direct Core damage는 전용 8-storage pass가
        // 공통 preflight로 예약된 event slot에 typed request로 기록합니다.
        return;
    }
    if (contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        ) && body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) == BODY_LAYER_CORE_PROXY) {
        // 전용 pass가 exact selected target/team/policy/budget/event capacity를
        // 모두 검증한 뒤 mutation하므로 generic handler에서는 marker만 남깁니다.
        mark_core_damage_request_candidate(contact_index);
        return;
    }
    if (contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        ) && body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) == BODY_LAYER_PLAYER_DAMAGEABLE) {
        // Tower 후보는 여기서 program state를 읽지 않고 marker만 남깁니다.
        // 전용 <=9-storage pass가 program/team/identity/policy/budget을 exact
        // 검증하고 self budget을 reserve한 뒤 공통 maximum-window marker로
        // 승격합니다. Tower HP/window/event mutation은 공통 resolver만 소유합니다.
        mark_selected_target_tower_candidate(
            contact_index,
            resolve_contact_source_modified_damage(
                self_body_id,
                contact,
                handler
            ),
            policy_event_flag
        );
        return;
    }
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    let source_modified_damage = resolve_contact_source_modified_damage(
        self_body_id,
        contact,
        handler
    );
    if (source_modified_damage <= 0) {
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            policy_event_type | policy_event_flag,
            contact.world_position
        ));
        return;
    }

    if (!contact_handler_accepts_target(self_body_id, other_body_id)) {
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            policy_event_type | policy_event_flag,
            contact.world_position
        ));
        return;
    }

    if (!gameplay_damage_is_allowed(
        simulations.values[self_body_id].gameplay_meta,
        simulations.values[other_body_id].gameplay_meta
    )) {
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            policy_event_type | policy_event_flag,
            contact.world_position
        ));
        return;
    }

    let self_budget_reserved = reserve_self_hit_budget(
        self_body_id,
        damage_self
    );
    if (!self_budget_reserved) {
        return;
    }
    let directional_flat_reduction = directional_defense_flat_reduction(contact);
    let final_damage = resolve_contact_target_mitigation(
        contact,
        source_modified_damage
    );
    let directional_defense_event_flag = select(
        0u,
        APPLIED_EVENT_FLAG_DIRECTIONAL_DEFENSE,
        directional_flat_reduction > 0
    );
    if (final_damage <= 0) {
        // Valid fully absorbed hits consume the source/self budget and remain observable.
        append_applied_event(AppliedEvent(
            simulations.values[self_body_id].entity_id,
            contact.self_incarnation,
            simulations.values[other_body_id].entity_id,
            contact.other_incarnation,
            0,
            APPLIED_EVENT_TYPE_DAMAGE_APPLIED
                | policy_event_flag
                | directional_defense_event_flag,
            contact.world_position
        ));
        return;
    }
    if (gameplay_damage_resolution_policy_id(
            simulations.values[other_body_id].gameplay_meta
        ) == GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW) {
        // Valid hit의 source budget은 이미 reserve되어 window가 0을 적용해도 소모됩니다.
        mark_maximum_damage_window_candidate(
            contact_index,
            final_damage,
            policy_event_flag
        );
        return;
    }
    let damage = apply_target_damage(other_body_id, final_damage);
    if (damage.applied <= 0) {
        if (damage_self > 0) {
            atomicAdd(&simulations.values[self_body_id].health, damage_self);
        }
        return;
    }

    let target_died_flag = select(
        0u,
        APPLIED_EVENT_FLAG_TARGET_DIED,
        damage.target_died != 0u
    );
    append_applied_event(AppliedEvent(
        simulations.values[self_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[other_body_id].entity_id,
        contact.other_incarnation,
        damage.applied,
        APPLIED_EVENT_TYPE_DAMAGE_APPLIED
            | policy_event_flag
            | directional_defense_event_flag
            | target_died_flag,
        contact.world_position
    ));
}

fn core_damage_request_candidate_is_valid(contact: Contact) -> bool {
    if (!contact_is_core_damage_request_candidate(contact)
        || contact.other_body_id < 0) {
        return false;
    }
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    if (self_body_id >= counts.body_count
        || other_body_id >= counts.body_count
        || self_body_id == other_body_id
        || simulations.values[self_body_id].incarnation
            != contact.self_incarnation
        || simulations.values[other_body_id].incarnation
            != contact.other_incarnation
        || !body_id_is_simulation_active(self_body_id)
        || !body_id_is_simulation_active(other_body_id)) {
        return false;
    }
    let handler = contact_handlers.values[self_body_id];
    let required_handler_flags = CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        | CONTACT_HANDLER_FLAG_CLOSEST_ONLY
        | CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY;
    if ((handler.flags & required_handler_flags) != required_handler_flags
        || (handler.flags & CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS) != 0u
        || body_interaction_layer(
            physics.values[self_body_id].interaction_meta
        ) != BODY_LAYER_PROJECTILE
        || body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) != BODY_LAYER_CORE_PROXY
        || combat_states.values[self_body_id].target_interaction_layer_mask
            != BODY_LAYER_CORE_PROXY
        || gameplay_team_id(simulations.values[self_body_id].gameplay_meta)
            != GAMEPLAY_TEAM_HOSTILE
        || enemy_behavior_states.values[self_body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE) {
        return false;
    }
    let selected_flags = atomicLoad(
        &enemy_behavior_states.values[self_body_id].flags
    );
    if (atomicLoad(&enemy_behavior_states.values[self_body_id].state)
            != BODY_CONTROL_SELECTED_TARGET_CORE
        || (selected_flags & (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE
        )) != (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE
        )
        || (selected_flags & ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER) != 0u
        || enemy_behavior_states.values[self_body_id].target_slot
            != other_body_id
        || enemy_behavior_states.values[self_body_id].target_entity_id
            != simulations.values[other_body_id].entity_id
        || enemy_behavior_states.values[self_body_id].target_incarnation
            != contact.other_incarnation
        || enemy_behavior_states.values[self_body_id].state_entered_fixed_tick
            == 0u
        || bitcast<u32>(enemy_behavior_states.values[self_body_id]
            .charge_direction.x) == 0u
        || bitcast<i32>(enemy_behavior_states.values[self_body_id].windup_range)
            <= 0) {
        return false;
    }
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    return damage_self > 0
        && atomicLoad(&simulations.values[self_body_id].health) >= damage_self;
}

fn selected_target_tower_candidate_is_valid(contact: Contact) -> bool {
    let policy_event_flag = selected_target_tower_policy_from_marker(
        bitcast<u32>(contact.normal.y)
    );
    if (policy_event_flag == 0u || contact.other_body_id < 0) {
        return false;
    }
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    if (self_body_id >= counts.body_count
        || other_body_id >= counts.body_count
        || self_body_id == other_body_id
        || simulations.values[self_body_id].incarnation
            != contact.self_incarnation
        || simulations.values[other_body_id].incarnation
            != contact.other_incarnation
        || !body_id_is_simulation_active(self_body_id)
        || !body_id_is_simulation_active(other_body_id)) {
        return false;
    }
    let handler = contact_handlers.values[self_body_id];
    let required_handler_flags = CONTACT_HANDLER_FLAG_CORE_DAMAGE_REQUEST
        | CONTACT_HANDLER_FLAG_CLOSEST_ONLY
        | CONTACT_HANDLER_FLAG_INTERACTION_ENTER_ONLY;
    if ((handler.flags & required_handler_flags) != required_handler_flags
        || (handler.flags & CONTACT_HANDLER_FLAG_INTERACTION_CONTINUOUS) != 0u
        || body_interaction_layer(
            physics.values[self_body_id].interaction_meta
        ) != BODY_LAYER_PROJECTILE
        || body_interaction_layer(
            physics.values[other_body_id].interaction_meta
        ) != BODY_LAYER_PLAYER_DAMAGEABLE
        || combat_states.values[self_body_id].target_interaction_layer_mask
            != BODY_LAYER_PLAYER_DAMAGEABLE
        || gameplay_team_id(simulations.values[self_body_id].gameplay_meta)
            != GAMEPLAY_TEAM_HOSTILE
        || enemy_behavior_states.values[self_body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_SELECTED_TARGET_PROJECTILE
        || !maximum_damage_window_target_is_configured(other_body_id)
        || !contact_handler_accepts_target(self_body_id, other_body_id)
        || !gameplay_damage_is_allowed(
            simulations.values[self_body_id].gameplay_meta,
            simulations.values[other_body_id].gameplay_meta
        )
        || bitcast<i32>(contact.normal.x) <= 0) {
        return false;
    }
    let selected_flags = atomicLoad(
        &enemy_behavior_states.values[self_body_id].flags
    );
    if (atomicLoad(&enemy_behavior_states.values[self_body_id].state)
            != BODY_CONTROL_SELECTED_TARGET_TOWER
        || (selected_flags & (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER
        )) != (
            ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_VALID
            | ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_TOWER
        )
        || (selected_flags & ENEMY_BEHAVIOR_FLAG_SELECTED_TARGET_CORE) != 0u
        || enemy_behavior_states.values[self_body_id].target_slot
            != other_body_id
        || enemy_behavior_states.values[self_body_id].target_entity_id
            != simulations.values[other_body_id].entity_id
        || enemy_behavior_states.values[self_body_id].target_incarnation
            != contact.other_incarnation
        || enemy_behavior_states.values[self_body_id].state_entered_fixed_tick
            == 0u
        || bitcast<u32>(enemy_behavior_states.values[self_body_id]
            .charge_direction.x) == 0u) {
        return false;
    }
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    return damage_self > 0
        && atomicLoad(&simulations.values[self_body_id].health) >= damage_self;
}

@compute @workgroup_size(256)
fn preflight_core_damage_requests(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.core_damage_request_protocol_status)
            != CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK) {
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
    if (core_damage_request_candidate_is_valid(contact)
        || (contact.other_body_id >= 0
            && hostile_direct_core_impact_is_valid(
                contact.self_body_id,
                u32(contact.other_body_id)
            ))) {
        atomicAdd(&contact_state.core_damage_request_event_count, 1u);
    }
}

@compute @workgroup_size(1)
fn finalize_core_damage_request_preflight() {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u) {
        atomicStore(
            &contact_state.core_damage_request_protocol_status,
            CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE
        );
        return;
    }
    let existing_event_count = atomicLoad(&contact_state.event_count);
    let request_count = atomicLoad(
        &contact_state.core_damage_request_event_count
    );
    let maximum_window_count = atomicLoad(
        &contact_state.maximum_damage_window_event_count
    );
    if (request_count > params.max_events
        || maximum_window_count > params.max_events - request_count
        || existing_event_count
            > params.max_events - request_count - maximum_window_count) {
        atomicStore(
            &contact_state.core_damage_request_protocol_status,
            CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE
        );
        atomicAdd(&contact_state.event_overflow, 1u);
    }
}

@compute @workgroup_size(256)
fn resolve_core_damage_requests(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.core_damage_request_protocol_status)
            != CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK) {
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
    if (selected_target_tower_candidate_is_valid(contact)) {
        let self_body_id = contact.self_body_id;
        let other_body_id = u32(contact.other_body_id);
        let handler = contact_handlers.values[self_body_id];
        let damage_self = max(i32(handler.damage_self * 100.0), 0);
        if (!reserve_self_hit_budget(self_body_id, damage_self)) {
            return;
        }
        let policy_event_flag = selected_target_tower_policy_from_marker(
            bitcast<u32>(contact.normal.y)
        );
        // M Tower도 유효 hit의 self/penetration budget은 여기서 먼저 소모하고,
        // HP/window/event mutation은 다른 모든 producer와 같은 resolver가 담당합니다.
        mark_maximum_damage_window_candidate(
            contact_index,
            bitcast<i32>(contact.normal.x),
            policy_event_flag
        );
        return;
    }
    if (!core_damage_request_candidate_is_valid(contact)) {
        return;
    }
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    let handler = contact_handlers.values[self_body_id];
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    if (!reserve_self_hit_budget(self_body_id, damage_self)) {
        return;
    }
    let core_damage_fixed_point = bitcast<i32>(
        enemy_behavior_states.values[self_body_id].windup_range
    );
    append_applied_event(AppliedEvent(
        simulations.values[self_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[other_body_id].entity_id,
        contact.other_incarnation,
        core_damage_fixed_point,
        APPLIED_EVENT_TYPE_CORE_DAMAGE_REQUEST,
        contact.world_position
    ));
}

@compute @workgroup_size(256)
fn resolve_direct_core_damage_requests(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.core_damage_request_protocol_status)
            != CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_OK) {
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
    let self_body_id = contact.self_body_id;
    let other_body_id = u32(contact.other_body_id);
    if (!hostile_direct_core_impact_is_valid(self_body_id, other_body_id)) {
        return;
    }
    append_applied_event(AppliedEvent(
        simulations.values[self_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[other_body_id].entity_id,
        contact.other_incarnation,
        resolve_direct_core_impact_damage(self_body_id),
        APPLIED_EVENT_TYPE_CORE_DAMAGE_REQUEST,
        contact.world_position
    ));
}

@compute @workgroup_size(256)
fn emit_enemy_charge_telegraphs(@builtin(global_invocation_id) global_id: vec3u) {
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
    let previous_flags = atomicAnd(
        &enemy_behavior_states.values[body_id].flags,
        ~ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING
    );
    if ((previous_flags & ENEMY_BEHAVIOR_FLAG_TELEGRAPH_PENDING) == 0u
        || atomicLoad(&enemy_behavior_states.values[body_id].state)
            != ENEMY_BEHAVIOR_STATE_WINDUP
        || !behavior_target_matches_gameplay_tower(body_id)) {
        return;
    }
    append_applied_event(AppliedEvent(
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        enemy_behavior_states.values[body_id].target_entity_id,
        enemy_behavior_states.values[body_id].target_incarnation,
        0,
        APPLIED_EVENT_TYPE_ENEMY_CHARGE_WINDUP_STARTED,
        physics.values[body_id].position
    ));
}

@compute @workgroup_size(256)
fn resolve_enemy_charge_contacts(@builtin(global_invocation_id) global_id: vec3u) {
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
    let policy_event_flag = maximum_damage_window_policy_from_marker(
        bitcast<u32>(contact.normal.y)
    );
    if (policy_event_flag == 0u
        || contact.other_body_id < 0) {
        return;
    }
    let body_id = contact.self_body_id;
    let target_slot = u32(contact.other_body_id);
    if (body_id >= counts.body_count
        || target_slot >= counts.body_count
        || enemy_behavior_states.values[body_id].program_id
            != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        || simulations.values[body_id].incarnation != contact.self_incarnation
        || simulations.values[target_slot].incarnation != contact.other_incarnation
        || !behavior_target_matches_gameplay_tower(body_id)
        || target_slot != enemy_behavior_states.values[body_id].target_slot
        || simulations.values[target_slot].entity_id
            != enemy_behavior_states.values[body_id].target_entity_id
        || contact.other_incarnation
            != enemy_behavior_states.values[body_id].target_incarnation) {
        return;
    }
    let impact_status = atomicLoad(
        &enemy_charge_impacts.values[body_id].status
    );
    if (impact_status != ENEMY_CHARGE_IMPACT_STATUS_CAPTURED
        || atomicLoad(
            &enemy_charge_impacts.values[body_id].selected_contact_index
        ) != contact_index
        || enemy_charge_impacts.values[body_id].captured_fixed_tick
            != params.fixed_tick
        || enemy_charge_impacts.values[body_id].arrow_slot != body_id
        || enemy_charge_impacts.values[body_id].tower_slot != target_slot
        || enemy_charge_impacts.values[body_id].arrow_entity_id
            != simulations.values[body_id].entity_id
        || enemy_charge_impacts.values[body_id].arrow_incarnation
            != contact.self_incarnation
        || enemy_charge_impacts.values[body_id].tower_entity_id
            != simulations.values[target_slot].entity_id
        || enemy_charge_impacts.values[body_id].tower_incarnation
            != contact.other_incarnation) {
        return;
    }
    loop {
        let state_exchange = atomicCompareExchangeWeak(
            &enemy_behavior_states.values[body_id].state,
            ENEMY_BEHAVIOR_STATE_CHARGE,
            ENEMY_BEHAVIOR_STATE_CONTACT_RECOIL
        );
        if (state_exchange.exchanged) {
            break;
        }
        if (state_exchange.old_value != ENEMY_BEHAVIOR_STATE_CHARGE) {
            return;
        }
    }
    enemy_behavior_states.values[body_id].state_entered_fixed_tick
        = params.fixed_tick;
    enemy_behavior_states.values[body_id].state_expires_at_fixed_tick
        = params.fixed_tick + enemy_behavior_states.values[body_id].recoil_ticks;
    atomicStore(
        &enemy_behavior_states.values[body_id].flags,
        ENEMY_BEHAVIOR_FLAG_TARGET_VALID
    );

    let normal = enemy_charge_impacts.values[body_id].contact_normal;
    let relative_velocity = enemy_charge_impacts.values[body_id]
        .pre_impact_relative_velocity;
    let arrow_inverse_mass = enemy_charge_impacts.values[body_id]
        .arrow_inverse_mass;
    let tower_inverse_mass = enemy_charge_impacts.values[body_id]
        .tower_inverse_mass;
    let inverse_mass_sum = arrow_inverse_mass + tower_inverse_mass;
    let normal_speed = dot(relative_velocity, normal);
    let sleep_threshold = max(
        enemy_behavior_states.values[body_id].recoil_sleep_threshold,
        0.0
    );
    if (inverse_mass_sum > EPSILON_MASS
        && normal_speed < -sleep_threshold) {
        let restitution = clamp(
            enemy_behavior_states.values[body_id].impact_restitution,
            0.0,
            1.0
        );
        let tangential_retention = clamp(
            enemy_behavior_states.values[body_id]
                .impact_tangential_retention,
            0.0,
            1.0
        );
        let tangential_velocity = relative_velocity - normal_speed * normal;
        let normal_impulse_magnitude = -(1.0 + restitution)
            * normal_speed / inverse_mass_sum;
        let tangential_impulse = (tangential_retention - 1.0)
            * tangential_velocity / inverse_mass_sum;
        let impulse = normal * normal_impulse_magnitude
            + tangential_impulse;
        let arrow_velocity_delta = impulse * arrow_inverse_mass;
        let tower_velocity_delta = -impulse * tower_inverse_mass;
        atomicAdd(
            &enemy_charge_impacts.values[body_id]
                .velocity_delta_x_fixed_point,
            encode_enemy_charge_velocity_delta(arrow_velocity_delta.x)
        );
        atomicAdd(
            &enemy_charge_impacts.values[body_id]
                .velocity_delta_y_fixed_point,
            encode_enemy_charge_velocity_delta(arrow_velocity_delta.y)
        );
        atomicAdd(
            &enemy_charge_impacts.values[target_slot]
                .velocity_delta_x_fixed_point,
            encode_enemy_charge_velocity_delta(tower_velocity_delta.x)
        );
        atomicAdd(
            &enemy_charge_impacts.values[target_slot]
                .velocity_delta_y_fixed_point,
            encode_enemy_charge_velocity_delta(tower_velocity_delta.y)
        );
    }
    atomicStore(
        &enemy_charge_impacts.values[body_id].status,
        ENEMY_CHARGE_IMPACT_STATUS_RESOLVED
    );
    append_applied_event(AppliedEvent(
        simulations.values[body_id].entity_id,
        contact.self_incarnation,
        simulations.values[target_slot].entity_id,
        contact.other_incarnation,
        0,
        APPLIED_EVENT_TYPE_ENEMY_CHARGE_CONTACT_RECOIL_STARTED,
        contact.world_position
    ));
}

@compute @workgroup_size(256)
fn mark_dead(@builtin(global_invocation_id) global_id: vec3u) {
    if (!abi_is_current()) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_alive(body_id)) {
        return;
    }
    var reason_flags = 0u;
    if (atomicLoad(&simulations.values[body_id].health) <= 0) {
        reason_flags |= DEATH_EVENT_FLAG_HEALTH;
    }
    let lifetime = simulations.values[body_id].lifetime;
    if (lifetime == 0.0) {
        reason_flags |= DEATH_EVENT_FLAG_LIFETIME;
    }
    if (reason_flags == 0u || !clear_alive_once(body_id)) {
        return;
    }
    append_death_event(body_id, reason_flags);
}

`;
