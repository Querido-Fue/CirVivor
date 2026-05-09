import { getData } from 'data/data_handler.js';

/**
 * @typedef {object} CollisionRule
 * @property {boolean} check - 충돌 판정 수행 여부입니다.
 * @property {boolean} resolve - 위치 해소 수행 여부입니다.
 * @property {boolean|null} movableA - 첫 번째 body 이동 허용 재정의입니다.
 * @property {boolean|null} movableB - 두 번째 body 이동 허용 재정의입니다.
 * @property {boolean} oneShotByProjectile - 투사체 중복 처리 여부입니다.
 * @property {boolean} applyImpactRotation - 회전 충격 적용 여부입니다.
 */

const COLLISION_RULES = getData('COLLISION_CONSTANTS').RULES;
const COLLISION_RULE_NONE = COLLISION_RULES.NONE;
export const COLLISION_RULE_DYNAMIC_RESOLVE = COLLISION_RULES.DYNAMIC_RESOLVE;
const COLLISION_RULE_ENEMY_PLAYER = COLLISION_RULES.ENEMY_PLAYER;
const COLLISION_RULE_PLAYER_ENEMY = COLLISION_RULES.PLAYER_ENEMY;
const COLLISION_RULE_PROJECTILE_ENEMY = COLLISION_RULES.PROJECTILE_ENEMY;
const COLLISION_RULE_PLAYER_PROJECTILE = COLLISION_RULES.PLAYER_PROJECTILE;
const COLLISION_RULE_PLAYER_ITEM = COLLISION_RULES.PLAYER_ITEM;
const COLLISION_RULE_PROJECTILE_PROJECTILE = COLLISION_RULES.PROJECTILE_PROJECTILE;
const COLLISION_RULE_WALL_PROJECTILE = COLLISION_RULES.WALL_PROJECTILE;
const COLLISION_RULE_PROJECTILE_WALL = COLLISION_RULES.PROJECTILE_WALL;
const COLLISION_RULE_WALL_OTHER = COLLISION_RULES.WALL_OTHER;
const COLLISION_RULE_OTHER_WALL = COLLISION_RULES.OTHER_WALL;

/**
 * 충돌 body kind 조합에 맞는 처리 규칙을 반환합니다.
 * @param {string} kindA - 첫 번째 body kind입니다.
 * @param {string} kindB - 두 번째 body kind입니다.
 * @returns {CollisionRule} 충돌 처리 규칙입니다.
 */
export function getCollisionRule(kindA, kindB) {
    if (kindA === 'enemy' && kindB === 'enemy') {
        return COLLISION_RULE_DYNAMIC_RESOLVE;
    }
    if (kindA === 'enemy' && kindB === 'player') {
        return COLLISION_RULE_ENEMY_PLAYER;
    }
    if (kindA === 'player' && kindB === 'enemy') {
        return COLLISION_RULE_PLAYER_ENEMY;
    }
    if ((kindA === 'enemy' && kindB === 'projectile') || (kindA === 'projectile' && kindB === 'enemy')) {
        return COLLISION_RULE_PROJECTILE_ENEMY;
    }
    if ((kindA === 'enemy' && kindB === 'item') || (kindA === 'item' && kindB === 'enemy')) {
        return COLLISION_RULE_NONE;
    }
    if (kindA === 'player' && kindB === 'player') {
        return COLLISION_RULE_DYNAMIC_RESOLVE;
    }
    if ((kindA === 'player' && kindB === 'projectile') || (kindA === 'projectile' && kindB === 'player')) {
        return COLLISION_RULE_PLAYER_PROJECTILE;
    }
    if ((kindA === 'player' && kindB === 'item') || (kindA === 'item' && kindB === 'player')) {
        return COLLISION_RULE_PLAYER_ITEM;
    }
    if (kindA === 'projectile' && kindB === 'projectile') {
        return COLLISION_RULE_PROJECTILE_PROJECTILE;
    }
    if ((kindA === 'projectile' && kindB === 'item') || (kindA === 'item' && kindB === 'projectile')) {
        return COLLISION_RULE_NONE;
    }
    if (kindA === 'item' && kindB === 'item') {
        return COLLISION_RULE_DYNAMIC_RESOLVE;
    }
    if (kindA === 'wall') {
        if (kindB === 'projectile') {
            return COLLISION_RULE_WALL_PROJECTILE;
        }
        return kindB === 'wall' ? COLLISION_RULE_NONE : COLLISION_RULE_WALL_OTHER;
    }
    if (kindB === 'wall') {
        if (kindA === 'projectile') {
            return COLLISION_RULE_PROJECTILE_WALL;
        }
        return kindA === 'wall' ? COLLISION_RULE_NONE : COLLISION_RULE_OTHER_WALL;
    }

    return COLLISION_RULE_NONE;
}
