import { getData } from 'data/data_handler.js';

const COLLISION_CONSTANTS = getData('COLLISION_CONSTANTS');
const PROJECTILE_IMPACT = COLLISION_CONSTANTS.PROJECTILE_IMPACT;
const EPSILON = COLLISION_CONSTANTS.EPSILON;
const ROTATION_IMPULSE_SCALE = PROJECTILE_IMPACT.ROTATION_IMPULSE_SCALE;
const ROTATION_RESPONSE_MULTIPLIER = PROJECTILE_IMPACT.ROTATION_RESPONSE_MULTIPLIER;
const PROJECTILE_WEIGHT_MIN = PROJECTILE_IMPACT.PROJECTILE_WEIGHT_MIN;
const ENEMY_WEIGHT_MIN = PROJECTILE_IMPACT.ENEMY_WEIGHT_MIN;

/**
 * 투사체 속도 축 값을 velocity, speed fallback 순서로 조회합니다.
 * @param {object} projectile - 검사할 투사체입니다.
 * @param {'x'|'y'} axis - 조회할 축입니다.
 * @returns {number} 유효하지 않으면 0으로 보정한 속도 축 값입니다.
 */
function getCollisionProjectileVelocityAxis(projectile, axis) {
    const velocityValue = projectile.velocity?.[axis];
    if (Number.isFinite(velocityValue)) {
        return velocityValue;
    }

    const speedValue = projectile.speed?.[axis];
    return Number.isFinite(speedValue) ? speedValue : 0;
}

/**
 * 충돌 충격 계산에 사용할 weight를 최소값 이상으로 보정합니다.
 * @param {object} target - weight를 가진 대상입니다.
 * @param {number} minWeight - 최소 weight입니다.
 * @returns {number} 보정된 weight입니다.
 */
function getCollisionImpactWeight(target, minWeight) {
    return Math.max(minWeight, Number.isFinite(target?.weight) ? target.weight : 1);
}

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

    const vx = getCollisionProjectileVelocityAxis(projectile, 'x');
    const vy = getCollisionProjectileVelocityAxis(projectile, 'y');
    const speed = Math.hypot(vx, vy);
    if (speed <= EPSILON) return;

    const impactX = Number.isFinite(manifold.pointX) ? manifold.pointX : enemy.position.x;
    const impactY = Number.isFinite(manifold.pointY) ? manifold.pointY : enemy.position.y;

    const relX = impactX - enemy.position.x;
    const relY = impactY - enemy.position.y;
    const projectileWeight = getCollisionImpactWeight(projectile, PROJECTILE_WEIGHT_MIN);
    const forceScale = (Number.isFinite(projectile.impactForce) ? projectile.impactForce : 1) * projectileWeight;
    const impulseX = (vx / speed) * speed * forceScale;
    const impulseY = (vy / speed) * speed * forceScale;
    const torque = (relX * impulseY) - (relY * impulseX);
    const weight = getCollisionImpactWeight(enemy, ENEMY_WEIGHT_MIN);
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
