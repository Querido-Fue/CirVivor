import { getData } from 'data/data_handler.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const PROJECTILE_IMPACT = COLLISION_CONSTANTS.PROJECTILE_IMPACT;
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const ROTATION_IMPULSE_SCALE = PROJECTILE_IMPACT.ROTATION_IMPULSE_SCALE;
const ROTATION_RESPONSE_MULTIPLIER = PROJECTILE_IMPACT.ROTATION_RESPONSE_MULTIPLIER;
const PROJECTILE_WEIGHT_MIN = PROJECTILE_IMPACT.PROJECTILE_WEIGHT_MIN;
const ENEMY_WEIGHT_MIN = PROJECTILE_IMPACT.ENEMY_WEIGHT_MIN;

/**
 * 투사체가 대상 적을 이미 타격했는지 반환합니다.
 * @param {object} projectile - 검사할 투사체입니다.
 * @param {number} targetId - 대상 적 ID입니다.
 * @returns {boolean} 이미 타격했는지 여부입니다.
 */
export function hasCollisionProjectileHit(projectile, targetId) {
    if (!projectile || !Number.isInteger(targetId)) return false;
    if (typeof projectile.hasHitEnemy === 'function') {
        return projectile.hasHitEnemy(targetId);
    }
    if (projectile.hitEnemyIds instanceof Set) {
        return projectile.hitEnemyIds.has(targetId);
    }
    return false;
}

/**
 * 투사체가 대상 적을 타격했다고 기록합니다.
 * @param {object} projectile - 기록할 투사체입니다.
 * @param {number} targetId - 대상 적 ID입니다.
 * @returns {void}
 */
export function markCollisionProjectileHit(projectile, targetId) {
    if (!projectile || !Number.isInteger(targetId)) return;
    if (typeof projectile.markEnemyHit === 'function') {
        projectile.markEnemyHit(targetId);
        return;
    }
    if (!(projectile.hitEnemyIds instanceof Set)) {
        projectile.hitEnemyIds = new Set();
    }
    projectile.hitEnemyIds.add(targetId);
}

/**
 * 투사체 충돌로 인한 적 회전 충격과 hit 처리를 적용합니다.
 * @param {object} projectile - 충돌한 투사체입니다.
 * @param {object} enemy - 충돌한 적입니다.
 * @param {object} manifold - 충돌 manifold입니다.
 * @returns {void}
 */
export function applyCollisionProjectileImpact(projectile, enemy, manifold) {
    if (!projectile || !enemy || !manifold) return;
    if (typeof enemy.addAngularImpulse !== 'function') return;

    const vx = Number.isFinite(projectile.velocity?.x)
        ? projectile.velocity.x
        : (Number.isFinite(projectile.speed?.x) ? projectile.speed.x : 0);
    const vy = Number.isFinite(projectile.velocity?.y)
        ? projectile.velocity.y
        : (Number.isFinite(projectile.speed?.y) ? projectile.speed.y : 0);
    const speed = Math.hypot(vx, vy);
    if (speed <= EPSILON) return;

    const impactX = Number.isFinite(manifold.pointX) ? manifold.pointX : enemy.position.x;
    const impactY = Number.isFinite(manifold.pointY) ? manifold.pointY : enemy.position.y;

    const relX = impactX - enemy.position.x;
    const relY = impactY - enemy.position.y;
    const projectileWeight = Math.max(
        PROJECTILE_WEIGHT_MIN,
        Number.isFinite(projectile.weight) ? projectile.weight : 1
    );
    const forceScale = (Number.isFinite(projectile.impactForce) ? projectile.impactForce : 1) * projectileWeight;
    const impulseX = (vx / speed) * speed * forceScale;
    const impulseY = (vy / speed) * speed * forceScale;
    const torque = (relX * impulseY) - (relY * impulseX);
    const weight = Math.max(ENEMY_WEIGHT_MIN, Number.isFinite(enemy.weight) ? enemy.weight : 1);
    const angularImpulse = (torque / weight) * ROTATION_IMPULSE_SCALE * ROTATION_RESPONSE_MULTIPLIER;

    enemy.lastImpactPoint = { x: impactX, y: impactY };
    enemy.lastImpactOffset = { x: relX, y: relY };
    enemy.lastImpactOffsetRatio = Math.min(
        1,
        Math.hypot(relX, relY) / Math.max(enemy.getRenderHeightPx?.() || 1, 1)
    );
    enemy.addAngularImpulse(angularImpulse, 1);

    if (typeof enemy.registerProjectileHit === 'function') {
        enemy.registerProjectileHit();
    } else if (Number.isFinite(enemy.projectileHitsToKill) && enemy.projectileHitsToKill > 0) {
        const hitCount = (Number.isFinite(enemy.projectileHitCount) ? enemy.projectileHitCount : 0) + 1;
        enemy.projectileHitCount = hitCount;
        if (hitCount >= enemy.projectileHitsToKill) {
            enemy.active = false;
        }
    }
}
