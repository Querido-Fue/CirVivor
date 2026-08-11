import {
    PROJECTILE_CAPTURE_POLICY_ID,
    normalizeProjectileLogicalMetadata
} from 'ingame/contract/projectile_capture_contract.js';

/**
 * Phase 5의 production technical baseline입니다.
 * Word/Sentence balance가 확정되기 전 GPU projectile 경로를 검증하는 최소 수치이며,
 * controller나 shader에 gameplay 숫자를 복제하지 않습니다.
 */
export const BASIC_BULLET_COLOR_RGBA = Object.freeze([
    1,
    0.86,
    0.22,
    1
]);

export const BASIC_BULLET_PRODUCER_ID = 'tower-primary-basic-bullet';
export const BASIC_BULLET_PROJECTILE_DEFINITION_ID = 'basic_bullet_01';

export const BASIC_BULLET_LOGICAL_PROJECTILE_METADATA = (
    normalizeProjectileLogicalMetadata(Object.freeze({
        archetypeId: BASIC_BULLET_PROJECTILE_DEFINITION_ID,
        wordTagMask: 0,
        modifierSetId: null,
        sourceExecutionId: null,
        projectileGeneration: 1
    }))
);

export const BASIC_BULLET_PROJECTILE_DATA = Object.freeze({
    id: BASIC_BULLET_PROJECTILE_DEFINITION_ID,
    projectileCapturePolicyId: PROJECTILE_CAPTURE_POLICY_ID.CAPTURABLE,
    ...BASIC_BULLET_LOGICAL_PROJECTILE_METADATA,
    collisionRadius: 0.18,
    inverseMass: 1,
    penetration: 1,
    damage: 10,
    damageSelf: 1,
    lifetimeSeconds: 2,
    killOnTerrain: true,
    closestOnly: true,
    colorRgba: BASIC_BULLET_COLOR_RGBA,
    radiusScale: 1,
    visible: true
});

export const BASIC_BULLET_WEAPON_DATA = Object.freeze({
    producerId: BASIC_BULLET_PRODUCER_ID,
    projectileSpeedTilesPerSecond: 18,
    fireIntervalTicks: 27,
    positionOffsetTiles: 0
});
