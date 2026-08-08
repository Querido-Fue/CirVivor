import {
    ARCHER_ATTACK_DEFINITION_ID,
    ARCHER_ENEMY_DEFINITION_ID
} from './archer_enemy_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA,
    HOSTILE_BASIC_BULLET_PRODUCER_ID
} from '../projectile/hostile_basic_bullet_data.js';

const ZERO_OFFSET = Object.freeze({ x: 0, y: 0 });

/**
 * R1 Turn 4의 data-authored technical attack baseline입니다.
 * 수치는 최종 balance가 아니며 fixed tick HostileAttackDirector가 검증해 소비합니다.
 */
export const ARCHER_ATTACK_DATA = Object.freeze({
    id: ARCHER_ATTACK_DEFINITION_ID,
    sourceEnemyDefinitionId: ARCHER_ENEMY_DEFINITION_ID,
    projectileDefinitionId: HOSTILE_BASIC_BULLET_DATA.id,
    launchSpeed: 12,
    positionOffset: ZERO_OFFSET,
    targetOffset: ZERO_OFFSET,
    initialDelayTicks: 30,
    intervalTicks: 90,
    phaseSpreadTicks: 30,
    maximumStartsPerFixedTick: 4,
    targetPolicy: 'current-single-living-tower',
    targetSnapshotPolicy: 'cast-start-exact-handle',
    allegiancePolicy: 'inherit-subject',
    targetPolicyId: HOSTILE_BASIC_BULLET_DATA.targetPolicyId,
    producerId: HOSTILE_BASIC_BULLET_PRODUCER_ID,
    sourceAbilityId: 'enemy.archer.shoot.basic-bullet'
});

/** HostileAttackDirector가 exact attackDefinitionId로 해석하는 불변 catalog입니다. */
export const HOSTILE_ATTACK_DEFINITION_BY_ID = Object.freeze({
    [ARCHER_ATTACK_DATA.id]: ARCHER_ATTACK_DATA
});
