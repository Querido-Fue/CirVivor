import {
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND
} from '../../contract/enemy_jorang_split_contract.js';

/**
 * FIRST_VALID_POSITIVE_DAMAGE_HIT의 producer-neutral WGSL seam입니다.
 * 포함하는 shader는 counts/simulations/atomic_transform_states와 body 활성
 * helper 및 J program/phase 상수를 같은 ABI로 제공해야 합니다. Producer는
 * 자기 hit-policy 검증을 끝낸 뒤 source/target/final damage/kind를 전달합니다.
 */
export const GPU_ATOMIC_TRANSFORM_POSITIVE_DAMAGE_HIT_WGSL = /* wgsl */`
const POSITIVE_DAMAGE_PRODUCER_PROJECTILE: u32 = ${
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND.PROJECTILE
}u;
const POSITIVE_DAMAGE_PRODUCER_EXPLOSION: u32 = ${
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND.EXPLOSION
}u;
const POSITIVE_DAMAGE_PRODUCER_EFFECT: u32 = ${
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND.EFFECT
}u;
const POSITIVE_DAMAGE_PRODUCER_DIRECT: u32 = ${
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND.DIRECT
}u;
const POSITIVE_DAMAGE_PRODUCER_MELEE: u32 = ${
    JORANG_SPLIT_POSITIVE_DAMAGE_PRODUCER_KIND.MELEE
}u;

fn atomic_transform_positive_damage_producer_kind_is_known(
    producer_kind: u32
) -> bool {
    return producer_kind == POSITIVE_DAMAGE_PRODUCER_PROJECTILE
        || producer_kind == POSITIVE_DAMAGE_PRODUCER_EXPLOSION
        || producer_kind == POSITIVE_DAMAGE_PRODUCER_EFFECT
        || producer_kind == POSITIVE_DAMAGE_PRODUCER_DIRECT
        || producer_kind == POSITIVE_DAMAGE_PRODUCER_MELEE;
}

fn atomic_transform_positive_damage_hit_is_valid_for_phase(
    source_body_id: u32,
    target_body_id: u32,
    target_incarnation: u32,
    final_positive_damage: i32,
    producer_kind: u32,
    producer_hit_policy_validated: bool,
    expected_phase: u32
) -> bool {
    if (!producer_hit_policy_validated
        || !atomic_transform_positive_damage_producer_kind_is_known(
            producer_kind
        )
        || final_positive_damage <= 0
        || source_body_id >= counts.body_count
        || target_body_id >= counts.body_count
        || source_body_id == target_body_id
        || !body_id_is_simulation_active(source_body_id)
        || !body_id_is_simulation_active(target_body_id)) {
        return false;
    }
    let source_entity_id = simulations.values[source_body_id].entity_id;
    let source_incarnation = simulations.values[source_body_id].incarnation;
    let target_entity_id = simulations.values[target_body_id].entity_id;
    let live_target_incarnation = simulations.values[target_body_id].incarnation;
    return source_entity_id != 0u
        && source_entity_id != INVALID_IDENTITY_COMPONENT
        && source_incarnation != 0u
        && source_incarnation != INVALID_IDENTITY_COMPONENT
        && target_entity_id != 0u
        && target_entity_id != INVALID_IDENTITY_COMPONENT
        && live_target_incarnation != 0u
        && live_target_incarnation != INVALID_IDENTITY_COMPONENT
        && live_target_incarnation == target_incarnation
        && atomic_transform_states.values[target_body_id].program_id
            == ATOMIC_TRANSFORM_PROGRAM_J_SPLIT_FIRST_HIT
        && atomicLoad(&atomic_transform_states.values[target_body_id].phase)
            == expected_phase
        && atomic_transform_states.values[target_body_id].entity_id
            == target_entity_id
        && atomic_transform_states.values[target_body_id].incarnation
            == target_incarnation;
}

fn try_commit_atomic_transform_first_valid_positive_damage_hit(
    source_body_id: u32,
    target_body_id: u32,
    target_incarnation: u32,
    final_positive_damage: i32,
    producer_kind: u32,
    producer_hit_policy_validated: bool,
    trigger_source_tick: u32,
    trigger_sequence: u32
) -> bool {
    if (!atomic_transform_positive_damage_hit_is_valid_for_phase(
        source_body_id,
        target_body_id,
        target_incarnation,
        final_positive_damage,
        producer_kind,
        producer_hit_policy_validated,
        ATOMIC_TRANSFORM_PHASE_ARMED
    )) {
        return false;
    }
    loop {
        let phase_change = atomicCompareExchangeWeak(
            &atomic_transform_states.values[target_body_id].phase,
            ATOMIC_TRANSFORM_PHASE_ARMED,
            ATOMIC_TRANSFORM_PHASE_SPLIT_PENDING
        );
        if (phase_change.exchanged) {
            atomicStore(
                &atomic_transform_states.values[target_body_id]
                    .trigger_source_tick,
                trigger_source_tick
            );
            atomicStore(
                &atomic_transform_states.values[target_body_id]
                    .trigger_sequence,
                trigger_sequence
            );
            return true;
        }
        if (phase_change.old_value != ATOMIC_TRANSFORM_PHASE_ARMED) {
            return false;
        }
    }
}
`;
