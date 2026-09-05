

export const COLLISION_ATOMIC_TRANSFORM_WGSL = /* wgsl */`fn atomic_transform_projectile_positive_damage_after_hit_policy(
    contact: Contact,
    expected_phase: u32
) -> i32 {
    if (contact.other_body_id < 0) {
        return 0;
    }
    let source_body_id = contact.self_body_id;
    let target_body_id = u32(contact.other_body_id);
    if (source_body_id >= counts.body_count
        || target_body_id >= counts.body_count
        || source_body_id == target_body_id) {
        return 0;
    }
    let source_entity_id = simulations.values[source_body_id].entity_id;
    let source_incarnation = simulations.values[source_body_id].incarnation;
    let target_incarnation = simulations.values[target_body_id].incarnation;
    if (source_entity_id == 0u
        || source_entity_id == INVALID_IDENTITY_COMPONENT
        || source_incarnation == 0u
        || source_incarnation == INVALID_IDENTITY_COMPONENT
        || source_incarnation != contact.self_incarnation
        || target_incarnation != contact.other_incarnation
        || !body_id_is_simulation_active(source_body_id)
        || !body_id_is_simulation_active(target_body_id)) {
        return 0;
    }
    let handler = contact_handlers.values[source_body_id];
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    if (body_layer(physics.values[source_body_id].physical_meta)
            != BODY_LAYER_PROJECTILE
        || !contact_handler_has_interaction_policy(handler.flags)
        || !contact_handler_has_flag(
            handler.flags,
            CONTACT_HANDLER_FLAG_CLOSEST_ONLY
        )
        || damage_self <= 0
        || atomicLoad(&simulations.values[source_body_id].health) < damage_self
        || (body_interaction_mask(
                physics.values[source_body_id].interaction_meta
            ) & body_interaction_layer(
                physics.values[target_body_id].interaction_meta
            )) == 0u
        || (body_interaction_mask(
                physics.values[target_body_id].interaction_meta
            ) & body_interaction_layer(
                physics.values[source_body_id].interaction_meta
            )) == 0u
        || !gameplay_damage_is_allowed(
            simulations.values[source_body_id].gameplay_meta,
            simulations.values[target_body_id].gameplay_meta
        )) {
        return 0;
    }
    let source_damage = resolve_contact_source_modified_damage(
        source_body_id,
        contact,
        handler
    );
    let final_damage = resolve_contact_target_mitigation(contact, source_damage);
    if (!atomic_transform_positive_damage_hit_is_valid_for_phase(
        source_body_id,
        target_body_id,
        contact.other_incarnation,
        final_damage,
        POSITIVE_DAMAGE_PRODUCER_PROJECTILE,
        true,
        expected_phase
    )) {
        return 0;
    }
    return final_damage;
}

fn atomic_transform_first_hit_candidate_is_valid(contact: Contact) -> bool {
    return atomic_transform_projectile_positive_damage_after_hit_policy(
        contact,
        ATOMIC_TRANSFORM_PHASE_ARMED
    ) > 0;
}

@compute @workgroup_size(256)
fn clear_atomic_transform_first_hit_candidates(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current() || global_id.x >= counts.body_count) {
        return;
    }
    let body_id = global_id.x;
    atomicStore(
        &atomic_transform_candidates.values[body_id].source_entity_id,
        INVALID_IDENTITY_COMPONENT
    );
    atomicStore(
        &atomic_transform_candidates.values[body_id].contact_index,
        INVALID_IDENTITY_COMPONENT
    );
    atomicStore(&atomic_transform_candidates.values[body_id].match_count, 0u);
    atomicStore(
        &atomic_transform_candidates.values[body_id].status,
        ATOMIC_TRANSFORM_CANDIDATE_STATUS_OK
    );
}

/** First pass: nondeterministic contact append index 대신 live source entityId ASC를 고릅니다. */
@compute @workgroup_size(256)
fn select_atomic_transform_first_hit_source(
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
    if (!atomic_transform_first_hit_candidate_is_valid(contact)) {
        return;
    }
    let target_body_id = u32(contact.other_body_id);
    atomicMin(
        &atomic_transform_candidates.values[target_body_id].source_entity_id,
        simulations.values[contact.self_body_id].entity_id
    );
}

/** Second pass: selected exact source의 unique canonical contact index를 확정합니다. */
@compute @workgroup_size(256)
fn resolve_atomic_transform_first_hit_contact(
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
    if (!atomic_transform_first_hit_candidate_is_valid(contact)) {
        return;
    }
    let target_body_id = u32(contact.other_body_id);
    let selected_source = atomicLoad(
        &atomic_transform_candidates.values[target_body_id].source_entity_id
    );
    if (simulations.values[contact.self_body_id].entity_id != selected_source) {
        return;
    }
    let prior_count = atomicAdd(
        &atomic_transform_candidates.values[target_body_id].match_count,
        1u
    );
    atomicMin(
        &atomic_transform_candidates.values[target_body_id].contact_index,
        contact_index
    );
    if (prior_count != 0u) {
        atomicStore(
            &atomic_transform_candidates.values[target_body_id].status,
            INVALID_IDENTITY_COMPONENT
        );
        atomicOr(
            &contact_state.atomic_transform_protocol_status,
            ATOMIC_TRANSFORM_CANDIDATE_STATUS_DUPLICATE_EXACT_CONTACT
        );
    }
}

fn atomic_transform_candidate_is_unique(body_id: u32) -> bool {
    return atomicLoad(&atomic_transform_candidates.values[body_id].match_count) == 1u
        && atomicLoad(&atomic_transform_candidates.values[body_id].contact_index)
            != INVALID_IDENTITY_COMPONENT;
}

/**
 * Single invocation O(N) seal: 모든 exact winner의 event range를 persistent
 * mutation 전에 전부 예약합니다. Event array order는 비권위입니다.
 */
@compute @workgroup_size(1)
fn seal_atomic_transform_first_hits() {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.atomic_transform_protocol_status) != 0u) {
        return;
    }
    var selected_count = 0u;
    for (var body_id = 0u; body_id < counts.body_count; body_id += 1u) {
        if (atomic_transform_candidate_is_unique(body_id)) {
            selected_count += 1u;
        }
    }
    let event_base = atomicLoad(&contact_state.event_count);
    // Retryable capacity rejection도 host가 exact whole-batch evidence를
    // decode할 수 있도록 mutation-free diagnostics를 먼저 고정합니다.
    atomicStore(&contact_state.atomic_transform_candidate_count, selected_count);
    atomicStore(&contact_state.atomic_transform_event_base, event_base);
    if (event_base > params.max_events
        || selected_count > params.max_events - event_base) {
        // Capacity rejection precedes event_count/budget/phase mutation and is
        // therefore a whole-batch zero-mutation rejection.
        atomicStore(
            &contact_state.atomic_transform_protocol_status,
            ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED
        );
        return;
    }
    for (var body_id = 0u; body_id < counts.body_count; body_id += 1u) {
        if (atomic_transform_candidate_is_unique(body_id)) {
            atomicStore(
                &atomic_transform_candidates.values[body_id].status,
                ATOMIC_TRANSFORM_CANDIDATE_STATUS_SELECTED_RANK_BASE
            );
        }
    }
    atomicStore(&contact_state.event_count, event_base + selected_count);
}

@compute @workgroup_size(256)
fn commit_atomic_transform_first_hits(
    @builtin(global_invocation_id) global_id: vec3u
) {
    // A post-seal budget/CAS conflict is protocol corruption, not retryable
    // capacity: peers may already be PENDING, so readback must discard the
    // sealed event range and force authoritative recovery as one batch.
    if (!abi_is_current() || global_id.x >= counts.body_count
        || atomicLoad(&contact_state.atomic_transform_protocol_status) != 0u) {
        return;
    }
    let target_body_id = global_id.x;
    let status = atomicLoad(
        &atomic_transform_candidates.values[target_body_id].status
    );
    if (status != ATOMIC_TRANSFORM_CANDIDATE_STATUS_SELECTED_RANK_BASE) {
        return;
    }
    let contact_index = atomicLoad(
        &atomic_transform_candidates.values[target_body_id].contact_index
    );
    let contact = contacts.values[contact_index];
    if (!atomic_transform_first_hit_candidate_is_valid(contact)) {
        atomicOr(
            &contact_state.atomic_transform_protocol_status,
            ATOMIC_TRANSFORM_CANDIDATE_STATUS_SOURCE_BUDGET_RESERVATION_FAILED
        );
        return;
    }
    let source_body_id = contact.self_body_id;
    let handler = contact_handlers.values[source_body_id];
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    let validated_positive_damage
        = atomic_transform_projectile_positive_damage_after_hit_policy(
            contact,
            ATOMIC_TRANSFORM_PHASE_ARMED
        );
    if (!reserve_self_hit_budget(source_body_id, damage_self)) {
        atomicOr(
            &contact_state.atomic_transform_protocol_status,
            ATOMIC_TRANSFORM_CANDIDATE_STATUS_SOURCE_BUDGET_RESERVATION_FAILED
        );
        return;
    }
    let rank = atomicAdd(
        &contact_state.atomic_transform_committed_count,
        1u
    );
    let event_index = atomicLoad(&contact_state.atomic_transform_event_base) + rank;
    if (!try_commit_atomic_transform_first_valid_positive_damage_hit(
        source_body_id,
        target_body_id,
        contact.other_incarnation,
        validated_positive_damage,
        POSITIVE_DAMAGE_PRODUCER_PROJECTILE,
        true,
        params.fixed_tick,
        event_index
    )) {
        atomicAdd(&simulations.values[source_body_id].health, damage_self);
        atomicOr(
            &contact_state.atomic_transform_protocol_status,
            ATOMIC_TRANSFORM_CANDIDATE_STATUS_PHASE_COMPARE_EXCHANGE_FAILED
        );
        return;
    }
    // Dawn은 NaN payload 상수의 직접 bitcast를 constant expression으로
    // 평가하려 할 수 있으므로 runtime local을 거쳐 marker를 기록합니다.
    var winner_marker_bits: u32 = ATOMIC_TRANSFORM_FIRST_HIT_MARKER_WINNER;
    contacts.values[contact_index].normal.y
        = bitcast<f32>(winner_marker_bits);
    applied_events.values[event_index] = AppliedEvent(
        simulations.values[source_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[target_body_id].entity_id,
        contact.other_incarnation,
        0,
        APPLIED_EVENT_TYPE_DAMAGE_APPLIED
            | interaction_policy_event_flag(handler.flags)
            | APPLIED_EVENT_FLAG_ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT,
        contact.world_position
    );
}

@compute @workgroup_size(1)
fn finalize_atomic_transform_first_hits() {
    if (!abi_is_current()) {
        return;
    }
    // EVENT_CAPACITY_EXCEEDED 단독 상태는 seal이 확정한 정상 whole-batch
    // rejection입니다. mixed/후속 status는 이 exact equality를 통과하지 않습니다.
    if (atomicLoad(&contact_state.atomic_transform_protocol_status)
        == ATOMIC_TRANSFORM_CANDIDATE_STATUS_EVENT_CAPACITY_EXCEEDED) {
        return;
    }
    let selected = atomicLoad(&contact_state.atomic_transform_candidate_count);
    let committed = atomicLoad(&contact_state.atomic_transform_committed_count);
    if (selected != committed) {
        atomicOr(
            &contact_state.atomic_transform_protocol_status,
            ATOMIC_TRANSFORM_CANDIDATE_STATUS_PHASE_COMPARE_EXCHANGE_FAILED
        );
    }
}

/** Winner와 exact valid pending follow-up만 generic handler mutation에서 차단합니다. */
@compute @workgroup_size(256)
fn shield_atomic_transform_first_hit_contacts(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()) {
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
    let target_body_id = u32(contact.other_body_id);
    if (target_body_id >= counts.body_count
        || simulations.values[target_body_id].incarnation
            != contact.other_incarnation
        || atomic_transform_states.values[target_body_id].program_id
            != ATOMIC_TRANSFORM_PROGRAM_J_SPLIT_FIRST_HIT) {
        return;
    }
    let marker = bitcast<u32>(contact.normal.y);
    if (marker == ATOMIC_TRANSFORM_FIRST_HIT_MARKER_WINNER) {
        return;
    }
    let phase = atomicLoad(&atomic_transform_states.values[target_body_id].phase);
    let protocol_failed = atomicLoad(
        &contact_state.atomic_transform_protocol_status
    ) != 0u;
    let valid_pending = phase == ATOMIC_TRANSFORM_PHASE_SPLIT_PENDING
        && atomic_transform_projectile_positive_damage_after_hit_policy(
            contact,
            ATOMIC_TRANSFORM_PHASE_SPLIT_PENDING
        ) > 0;
    let valid_failed_armed = protocol_failed
        && phase == ATOMIC_TRANSFORM_PHASE_ARMED
        && atomic_transform_projectile_positive_damage_after_hit_policy(
            contact,
            ATOMIC_TRANSFORM_PHASE_ARMED
        ) > 0;
    if (valid_pending || valid_failed_armed) {
        var shield_marker_bits: u32 = ATOMIC_TRANSFORM_FIRST_HIT_MARKER_SHIELD;
        contacts.values[contact_index].normal.y
            = bitcast<f32>(shield_marker_bits);
    }
}

@compute @workgroup_size(256)
fn shield_unselected_enemy_charge_contacts(
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
    if (!enemy_charge_contact_matches_bound_tower(contact)) {
        return;
    }
    let arrow_slot = contact.self_body_id;
    let is_selected_armed_contact = atomicLoad(
            &enemy_behavior_states.values[arrow_slot].state
        ) == ENEMY_BEHAVIOR_STATE_CHARGE
        && atomicLoad(
            &enemy_charge_impacts.values[arrow_slot].status
        ) == ENEMY_CHARGE_IMPACT_STATUS_CAPTURED
        && atomicLoad(
            &enemy_charge_impacts.values[arrow_slot].selected_contact_index
        ) == contact_index;
    if (is_selected_armed_contact) {
        return;
    }
    // CONTACT_RECOIL/RECOVER 중 overlap과 duplicate exact contact를 공통
    // handler에서 차단해 damage/event/impulse를 하나의 selected identity로 묶습니다.
    var shield_bits: u32 = ENEMY_CHARGE_DISARMED_SHIELD;
    contacts.values[contact_index].normal.y = bitcast<f32>(shield_bits);
}

`;
