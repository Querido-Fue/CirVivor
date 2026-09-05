

export const COLLISION_DAMAGE_WINDOW_WGSL = /* wgsl */`struct DamageResult {
    applied: i32,
    target_died: u32,
}

fn reserve_self_hit_budget(body_id: u32, amount: i32) -> bool {
    if (amount <= 0) {
        return true;
    }
    loop {
        let health_before = atomicLoad(&simulations.values[body_id].health);
        if (health_before < amount) {
            return false;
        }
        let reservation = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            health_before,
            health_before - amount
        );
        if (reservation.exchanged) {
            return true;
        }
    }
}

fn apply_target_damage(body_id: u32, amount: i32) -> DamageResult {
    if (amount <= 0) {
        return DamageResult(0, 0u);
    }
    loop {
        let health_before = atomicLoad(&simulations.values[body_id].health);
        if (health_before <= 0) {
            return DamageResult(0, 1u);
        }
        let applied_amount = min(health_before, amount);
        let health_after = health_before - applied_amount;
        let exchange = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            health_before,
            health_after
        );
        if (exchange.exchanged) {
            return DamageResult(
                applied_amount,
                select(0u, 1u, health_after == 0)
            );
        }
    }
}

fn clear_alive_once(body_id: u32) -> bool {
    let alive_bit = BODY_FLAG_ALIVE;
    let previous_meta = atomicAnd(
        &simulations.values[body_id].flags,
        ~alive_bit
    );
    return (previous_meta & alive_bit) != 0u;
}

fn append_applied_event(event: AppliedEvent) {
    let event_index = atomicAdd(&contact_state.event_count, 1u);
    if (event_index >= params.max_events) {
        atomicAdd(&contact_state.event_overflow, 1u);
        return;
    }
    applied_events.values[event_index] = event;
}

fn append_death_event(body_id: u32, reason_flags: u32) {
    let death_index = atomicAdd(&contact_state.death_count, 1u);
    if (death_index >= params.max_death_events) {
        atomicAdd(&contact_state.death_overflow, 1u);
        return;
    }
    death_events.values[death_index] = DeathEvent(
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        body_id,
        reason_flags
    );
}

fn contact_handler_accepts_target(self_body_id: u32, other_body_id: u32) -> bool {
    let target_interaction_layer = body_interaction_layer(
        physics.values[other_body_id].interaction_meta
    );
    let target_mask = combat_states.values[self_body_id]
        .target_interaction_layer_mask;
    return target_mask != 0u
        && (target_mask & target_interaction_layer) != 0u;
}

fn resolve_contact_source_modified_damage(
    self_body_id: u32,
    contact: Contact,
    handler: ContactHandler
) -> i32 {
    var source_modified_damage = handler.damage_other;
    if (handler.damage_falloff > 0.0) {
        let self_radius = physics.values[self_body_id].radius;
        if (self_radius > EPSILON_MASS) {
            let distance_from_self = length(
                contact.world_position - physics.values[self_body_id].position
            );
            let falloff_t = clamp(distance_from_self / self_radius, 0.0, 1.0);
            source_modified_damage *= 1.0 - pow(falloff_t, handler.damage_falloff);
        }
    }
    return max(i32(source_modified_damage * 100.0), 0);
}

fn resolve_contact_target_mitigation(
    contact: Contact,
    source_modified_damage: i32
) -> i32 {
    return max(
        source_modified_damage - directional_defense_flat_reduction(contact),
        0
    );
}

fn hostile_direct_core_impact_is_valid(
    source_body_id: u32,
    target_body_id: u32
) -> bool {
    return body_interaction_layer(
            physics.values[source_body_id].interaction_meta
        ) == BODY_LAYER_ENEMY
        && body_interaction_layer(
            physics.values[target_body_id].interaction_meta
        ) == BODY_LAYER_CORE_PROXY
        && gameplay_team_id(simulations.values[source_body_id].gameplay_meta)
            == GAMEPLAY_TEAM_HOSTILE
        && combat_states.values[source_body_id].direct_core_damage_fixed_point > 0
        && gameplay_damage_is_allowed(
            simulations.values[source_body_id].gameplay_meta,
            simulations.values[target_body_id].gameplay_meta
        );
}

fn resolve_direct_core_impact_damage(source_body_id: u32) -> i32 {
    let authored_damage = max(
        combat_states.values[source_body_id].direct_core_damage_fixed_point,
        0
    );
    let attack_multiplier = effect_attack_multiplier_for_channel(
        source_body_id,
        EFFECT_DAMAGE_CHANNEL_DIRECT_CORE_IMPACT
    );
    return max(i32(f32(authored_damage) * attack_multiplier), 0);
}

fn mark_maximum_damage_window_candidate(
    contact_index: u32,
    final_damage: i32,
    policy_event_flag: u32
) {
    // handle_contacts 뒤에는 contact.normal을 physical solve가 읽지 않습니다. 따라서
    // final damage와 quiet-NaN namespace marker를 이 tick 한정으로 재사용해 window
    // pass가 contact-handler storage를 추가로 bind하지 않게 합니다.
    let policy_marker = maximum_damage_window_marker_for_policy(policy_event_flag);
    contacts.values[contact_index].normal = vec2f(
        bitcast<f32>(final_damage),
        bitcast<f32>(policy_marker)
    );
}

fn maximum_damage_window_marker_for_policy(policy_event_flag: u32) -> u32 {
    if (policy_event_flag == APPLIED_EVENT_FLAG_ENTER_POLICY) {
        return MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_ENTER;
    }
    if (policy_event_flag == APPLIED_EVENT_FLAG_CONTINUOUS_POLICY) {
        return MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC
            | MAXIMUM_DAMAGE_WINDOW_MARKER_POLICY_CONTINUOUS;
    }
    return 0u;
}

fn maximum_damage_window_policy_from_marker(marker: u32) -> u32 {
    if ((marker & MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC_MASK)
        != MAXIMUM_DAMAGE_WINDOW_MARKER_MAGIC) {
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

struct MaximumDamageWindowCandidate {
    found: u32,
    final_damage: i32,
    source_entity_id: u32,
    source_incarnation: u32,
    policy_event_flag: u32,
}

fn empty_maximum_damage_window_candidate() -> MaximumDamageWindowCandidate {
    return MaximumDamageWindowCandidate(
        0u,
        0,
        INVALID_IDENTITY_COMPONENT,
        INVALID_IDENTITY_COMPONENT,
        0u
    );
}

fn maximum_damage_window_candidate_is_better(
    candidate: MaximumDamageWindowCandidate,
    current: MaximumDamageWindowCandidate
) -> bool {
    return current.found == 0u
        || candidate.final_damage > current.final_damage
        || (candidate.final_damage == current.final_damage
            && (candidate.source_entity_id < current.source_entity_id
                || (candidate.source_entity_id == current.source_entity_id
                    && candidate.source_incarnation < current.source_incarnation)));
}

fn find_maximum_damage_window_candidate(
    target_body_id: u32
) -> MaximumDamageWindowCandidate {
    var result = empty_maximum_damage_window_candidate();
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    for (var contact_index = 0u;
        contact_index < contact_count;
        contact_index += 1u) {
        let contact = contacts.values[contact_index];
        let marker = bitcast<u32>(contact.normal.y);
        var policy_event_flag = maximum_damage_window_policy_from_marker(marker);
        if (policy_event_flag == 0u
            && selected_target_tower_candidate_is_valid(contact)) {
            policy_event_flag = selected_target_tower_policy_from_marker(marker);
        }
        if (policy_event_flag == 0u
            || contact.other_body_id < 0
            || u32(contact.other_body_id) != target_body_id
            || contact.other_incarnation
                != simulations.values[target_body_id].incarnation) {
            continue;
        }
        let source_body_id = contact.self_body_id;
        if (source_body_id >= counts.body_count
            || simulations.values[source_body_id].incarnation
                != contact.self_incarnation) {
            continue;
        }
        let final_damage = bitcast<i32>(contact.normal.x);
        if (final_damage <= 0) {
            continue;
        }
        let candidate = MaximumDamageWindowCandidate(
            1u,
            final_damage,
            simulations.values[source_body_id].entity_id,
            contact.self_incarnation,
            policy_event_flag
        );
        if (maximum_damage_window_candidate_is_better(candidate, result)) {
            result = candidate;
        }
    }
    return result;
}

fn maximum_damage_window_target_is_configured(body_id: u32) -> bool {
    return gameplay_damage_resolution_policy_id(
        simulations.values[body_id].gameplay_meta
    ) == GAMEPLAY_DAMAGE_RESOLUTION_POLICY_MAXIMUM_DAMAGE_WINDOW;
}

fn clear_maximum_damage_window_state(body_id: u32) {
    atomicStore(
        &combat_states.values[body_id].peak_final_damage_fixed_point,
        0
    );
    atomicStore(&combat_states.values[body_id].expires_at_fixed_tick, 0u);
    atomicStore(
        &combat_states.values[body_id].peak_source_entity_id,
        INVALID_IDENTITY_COMPONENT
    );
    atomicStore(
        &combat_states.values[body_id].peak_source_incarnation,
        INVALID_IDENTITY_COMPONENT
    );
}

fn maximum_damage_window_tick_is_representable(duration: u32) -> bool {
    return duration > 0u && params.fixed_tick <= (0xffffffffu - duration);
}

@compute @workgroup_size(256)
fn preflight_maximum_damage_window(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.maximum_damage_window_protocol_status)
            != MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || !body_id_is_simulation_active(body_id)
        || !maximum_damage_window_target_is_configured(body_id)) {
        return;
    }
    let duration = combat_states.values[body_id]
        .maximum_damage_window_duration_fixed_ticks;
    let expires_at_fixed_tick = atomicLoad(
        &combat_states.values[body_id].expires_at_fixed_tick
    );
    let window_is_active = params.fixed_tick < expires_at_fixed_tick;
    let candidate = find_maximum_damage_window_candidate(body_id);
    if (candidate.found == 0u) {
        return;
    }
    let current_peak = select(
        0,
        atomicLoad(&combat_states.values[body_id].peak_final_damage_fixed_point),
        window_is_active
    );
    let resets_window = !window_is_active || candidate.final_damage > current_peak;
    if (resets_window
        && !maximum_damage_window_tick_is_representable(duration)) {
        atomicStore(
            &contact_state.maximum_damage_window_protocol_status,
            MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE
        );
        return;
    }
    // 유효 winner는 delta가 0이어도 exact provenance의 DAMAGE_APPLIED fact를 남긴다.
    if (atomicLoad(&simulations.values[body_id].health) > 0) {
        atomicAdd(&contact_state.maximum_damage_window_event_count, 1u);
    }
}

// preflight의 body-parallel count가 모두 끝난 뒤 단 한 invocation이 global event
// capacity를 확정합니다. resolver는 이 barrier 뒤에는 HP/window만 mutate하므로
// 여러 Tower가 같은 tick에 있어도 late failure가 부분 mutation을 만들 수 없습니다.
@compute @workgroup_size(1)
fn finalize_maximum_damage_window_preflight() {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.maximum_damage_window_protocol_status)
            != MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
        atomicStore(
            &contact_state.maximum_damage_window_protocol_status,
            MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE
        );
        return;
    }
    let existing_event_count = atomicLoad(&contact_state.event_count);
    let maximum_damage_window_event_count = atomicLoad(
        &contact_state.maximum_damage_window_event_count
    );
    let core_damage_request_event_count = atomicLoad(
        &contact_state.core_damage_request_event_count
    );
    if (maximum_damage_window_event_count > params.max_events
        || core_damage_request_event_count
            > params.max_events - maximum_damage_window_event_count
        || existing_event_count > params.max_events
            - maximum_damage_window_event_count
            - core_damage_request_event_count) {
        atomicStore(
            &contact_state.maximum_damage_window_protocol_status,
            MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_FAILURE
        );
        atomicStore(
            &contact_state.core_damage_request_protocol_status,
            CORE_DAMAGE_REQUEST_PROTOCOL_STATUS_FAILURE
        );
        atomicAdd(&contact_state.event_overflow, 1u);
    }
}

@compute @workgroup_size(256)
fn resolve_maximum_damage_window(
    @builtin(global_invocation_id) global_id: vec3u
) {
    if (!abi_is_current()
        || atomicLoad(&contact_state.contact_overflow) != 0u
        || atomicLoad(&contact_state.event_overflow) != 0u
        || atomicLoad(&contact_state.maximum_damage_window_protocol_status)
            != MAXIMUM_DAMAGE_WINDOW_PROTOCOL_STATUS_OK) {
        return;
    }
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || !body_id_is_simulation_active(body_id)
        || !maximum_damage_window_target_is_configured(body_id)) {
        return;
    }
    let duration = combat_states.values[body_id]
        .maximum_damage_window_duration_fixed_ticks;
    let expires_at_fixed_tick = atomicLoad(
        &combat_states.values[body_id].expires_at_fixed_tick
    );
    let window_is_active = params.fixed_tick < expires_at_fixed_tick;
    if (!window_is_active) {
        clear_maximum_damage_window_state(body_id);
    }
    let candidate = find_maximum_damage_window_candidate(body_id);
    if (candidate.found == 0u) {
        return;
    }
    if (atomicLoad(&simulations.values[body_id].health) <= 0) {
        return;
    }
    let current_peak = select(
        0,
        atomicLoad(&combat_states.values[body_id].peak_final_damage_fixed_point),
        window_is_active
    );
    let requested_damage = select(
        candidate.final_damage,
        max(candidate.final_damage - current_peak, 0),
        window_is_active
    );
    if (!window_is_active) {
        atomicStore(
            &combat_states.values[body_id].peak_final_damage_fixed_point,
            candidate.final_damage
        );
        atomicStore(
            &combat_states.values[body_id].expires_at_fixed_tick,
            params.fixed_tick + duration
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_entity_id,
            candidate.source_entity_id
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_incarnation,
            candidate.source_incarnation
        );
    } else if (candidate.final_damage > current_peak) {
        // 더 큰 peak가 winner이면 그 tick부터 새 damage window를 시작합니다.
        atomicStore(
            &combat_states.values[body_id].peak_final_damage_fixed_point,
            candidate.final_damage
        );
        atomicStore(
            &combat_states.values[body_id].expires_at_fixed_tick,
            params.fixed_tick + duration
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_entity_id,
            candidate.source_entity_id
        );
        atomicStore(
            &combat_states.values[body_id].peak_source_incarnation,
            candidate.source_incarnation
        );
    }
    let damage = apply_target_damage(body_id, requested_damage);
    let target_died_flag = select(
        0u,
        APPLIED_EVENT_FLAG_TARGET_DIED,
        damage.target_died != 0u
    );
    append_applied_event(AppliedEvent(
        candidate.source_entity_id,
        candidate.source_incarnation,
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        damage.applied,
        APPLIED_EVENT_TYPE_DAMAGE_APPLIED
            | candidate.policy_event_flag
            | APPLIED_EVENT_FLAG_MAXIMUM_DAMAGE_WINDOW
            | target_died_flag,
        physics.values[body_id].position
    ));
}

/** Projectile producer adapter: own policy validation precedes the common seam. */
`;
