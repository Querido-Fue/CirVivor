import {
    PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID
} from 'ingame/contract/projectile_target_policy_contract.js';
import {
    MAIN_GPU_ENEMY_COLOR_RGBA
} from '../enemy/main_gpu_enemy_definition_data.js';

export const HOSTILE_RHOM_PROJECTILE_PRODUCER_ID
    = 'enemy-rhom-core-priority-shot';
export const HOSTILE_RHOM_CORE_DAMAGE_REQUEST_POLICY_ID
    = PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID.TYPED_CPU_CORE_DAMAGE;

/**
 * Diamond M이 GPU-selected exact Core/Tower target에 사용하는 projectile입니다.
 * Tower damage는 기존 PLAYER_DAMAGEABLE 경로, Core damage는 typed CPU request입니다.
 */
export const HOSTILE_RHOM_PROJECTILE_DATA = Object.freeze({
    id: 'hostile_rhom_projectile_01',
    collisionRadius: 0.18,
    inverseMass: 1,
    penetration: 1,
    damage: 5,
    coreDamage: 5,
    damageSelf: 1,
    lifetimeSeconds: 3,
    killOnTerrain: true,
    closestOnly: true,
    targetPolicyId:
        PROJECTILE_TARGET_POLICY_ID
            .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN,
    towerTargetPolicyId:
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
    coreTargetPolicyId:
        PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN,
    coreDamageRequestPolicyId: HOSTILE_RHOM_CORE_DAMAGE_REQUEST_POLICY_ID,
    requiresExactSelectedTarget: true,
    producerId: HOSTILE_RHOM_PROJECTILE_PRODUCER_ID,
    colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
    radiusScale: 1,
    visible: true
});
