import {
    MAIN_GPU_ENEMY_COLOR_RGBA
} from '../enemy/main_gpu_enemy_definition_data.js';

export const HOSTILE_BASIC_BULLET_PRODUCER_ID = 'enemy-archer-basic-shot';
export const HOSTILE_BASIC_BULLET_COLOR_RGBA = MAIN_GPU_ENEMY_COLOR_RGBA;

/** Archer hostile attack의 R1 technical projectile baseline입니다. */
export const HOSTILE_BASIC_BULLET_DATA = Object.freeze({
    id: 'hostile_basic_bullet_01',
    collisionRadius: 0.18,
    inverseMass: 1,
    penetration: 1,
    damage: 5,
    damageSelf: 1,
    lifetimeSeconds: 3,
    killOnTerrain: true,
    closestOnly: true,
    targetPolicyId: 'player-damageable-and-terrain',
    producerId: HOSTILE_BASIC_BULLET_PRODUCER_ID,
    colorRgba: HOSTILE_BASIC_BULLET_COLOR_RGBA,
    radiusScale: 1,
    visible: true
});
