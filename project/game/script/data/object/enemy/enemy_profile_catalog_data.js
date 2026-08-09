import {
    ENEMY_FORMATION_POLICY,
    normalizeEnemyProfileCatalog
} from 'ingame/contract/enemy_profile_contract.js';
import {
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES
} from './enemy_shape_geometry_data.js';

/** main GPU enemy의 legacy geometry에서 유도한 단일 원형 collider 반경입니다. */
export const MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES = (
    LEGACY_SQUARE_ENEMY_COLLISION_RADIUS_TILES / 2
) * 1.3;

/** main GPU enemy 간 physical solve에 쓰는 radius 비율입니다. */
export const MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE = 0.8;

/** main GPU enemy archetype이 공유하는 hostile render color입니다. */
export const MAIN_GPU_ENEMY_COLOR_RGBA = Object.freeze([
    1,
    0.4235294117647059,
    0.4235294117647059,
    1
]);

export const MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID = 'main-gpu-enemy-physics-01';
export const MAIN_GPU_ENEMY_COMBAT_PROFILE_ID = 'main-gpu-enemy-combat-01';
export const CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID = 'core-route-contact-01';
export const ARCHER_CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID = 'archer-core-route-01';
export const ARCHER_ATTACK_DEFINITION_ID = 'archer_basic_shot_01';

const ENEMY_PROFILE_CATALOG_SOURCE = Object.freeze({
    physics: Object.freeze([
        Object.freeze({
            id: MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID,
            collisionRadiusTiles: MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
            weight: 1,
            pairCollisionRadiusScale: MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE,
            knockbackResistancePolicy: 'inverse-mass'
        })
    ]),
    combat: Object.freeze([
        Object.freeze({
            id: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
            maxHealth: 1,
            towerContactDamage: 0.1,
            coreImpactDamage: 1,
            bountyBudget: 1
        })
    ]),
    behavior: Object.freeze([
        Object.freeze({
            id: CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
            navigationObjective: 'core-route',
            navigationMode: 'route-flow-field',
            moveSpeedTilesPerSecond: 2.5,
            towerEngagement: 'continuous-contact',
            towerTargetSelection: 'none',
            towerPhysicalResponse: 'weight-based-pushable',
            fallback: 'route-stage-goal',
            attackDefinitionId: null,
            coreImpactPolicy: 'despawn-on-core-impact',
            formationPolicy: ENEMY_FORMATION_POLICY.NONE
        }),
        Object.freeze({
            id: ARCHER_CORE_ROUTE_ENEMY_BEHAVIOR_PROFILE_ID,
            navigationObjective: 'core-route',
            navigationMode: 'route-flow-field',
            moveSpeedTilesPerSecond: 2.5,
            towerEngagement: 'continuous-contact',
            towerTargetSelection: 'current-single-living-tower',
            towerPhysicalResponse: 'weight-based-pushable',
            fallback: 'route-stage-goal',
            attackDefinitionId: ARCHER_ATTACK_DEFINITION_ID,
            coreImpactPolicy: 'despawn-on-core-impact',
            formationPolicy: ENEMY_FORMATION_POLICY.NONE
        })
    ])
});

/**
 * 모든 profile은 source object와 분리된 deep-normalized immutable catalog입니다.
 * EnemyDefinition은 profile ID만 보관하고 runtime에서 이 catalog를 해석합니다.
 */
export const ENEMY_PROFILE_CATALOG = normalizeEnemyProfileCatalog(
    ENEMY_PROFILE_CATALOG_SOURCE
);

export const ENEMY_PHYSICS_PROFILE_BY_ID = ENEMY_PROFILE_CATALOG.physicsById;
export const ENEMY_COMBAT_PROFILE_BY_ID = ENEMY_PROFILE_CATALOG.combatById;
export const ENEMY_BEHAVIOR_PROFILE_BY_ID = ENEMY_PROFILE_CATALOG.behaviorById;
