import { clonePointSnapshot } from './game_scene_shadow_snapshot_entities.js';
import { DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS } from './game_scene_shadow_enemy_defaults.js';

const AXIS_RESISTANCE_EPSILON = 1e-4;
const MAX_SHADOW_ANGULAR_VELOCITY = 720;

/**
 * 적 상태 이상을 초기화합니다.
 * @param {object|null|undefined} enemy
 */
export function clearShadowEnemyStatus(enemy) {
    if (!enemy?.status || typeof enemy.status !== 'object') {
        return;
    }

    enemy.status.id = null;
    enemy.status.type = 'none';
    enemy.status.time = 0;
    enemy.status.remainingTime = 0;
    enemy.status.factor = {};
}

/**
 * 축 저항을 메인 시뮬레이션과 같은 방식으로 서서히 복구합니다.
 * @param {object} enemy
 * @param {number} delta
 */
export function recoverShadowEnemyAxisResistance(enemy, delta) {
    if (!Number.isFinite(delta) || delta <= 0 || !enemy) {
        return;
    }

    const recoverySeconds = Number.isFinite(enemy.axisResistanceRecoverySeconds) && enemy.axisResistanceRecoverySeconds > 0
        ? enemy.axisResistanceRecoverySeconds
        : DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS;

    if ((1 - enemy.axisResistanceX) <= AXIS_RESISTANCE_EPSILON) {
        enemy.axisResistanceX = 1;
        enemy.axisResistanceRecoverStartX = 1;
        enemy.axisResistanceRecoverElapsedX = recoverySeconds;
        enemy.axisResistanceRecoverHoldX = 0;
    } else if (enemy.axisResistanceRecoverHoldX > 0) {
        enemy.axisResistanceRecoverHoldX = Math.max(0, enemy.axisResistanceRecoverHoldX - delta);
    } else {
        const nextElapsedX = Math.min(recoverySeconds, enemy.axisResistanceRecoverElapsedX + delta);
        enemy.axisResistanceRecoverElapsedX = nextElapsedX;
        const tx = recoverySeconds <= AXIS_RESISTANCE_EPSILON ? 1 : (nextElapsedX / recoverySeconds);
        const smoothX = tx * tx * (3 - (2 * tx));
        const startX = Number.isFinite(enemy.axisResistanceRecoverStartX) ? enemy.axisResistanceRecoverStartX : enemy.axisResistanceX;
        enemy.axisResistanceX = startX + ((1 - startX) * smoothX);
        if ((1 - enemy.axisResistanceX) <= AXIS_RESISTANCE_EPSILON || tx >= 1) {
            enemy.axisResistanceX = 1;
            enemy.axisResistanceRecoverStartX = 1;
            enemy.axisResistanceRecoverElapsedX = recoverySeconds;
        }
    }

    if ((1 - enemy.axisResistanceY) <= AXIS_RESISTANCE_EPSILON) {
        enemy.axisResistanceY = 1;
        enemy.axisResistanceRecoverStartY = 1;
        enemy.axisResistanceRecoverElapsedY = recoverySeconds;
        enemy.axisResistanceRecoverHoldY = 0;
    } else if (enemy.axisResistanceRecoverHoldY > 0) {
        enemy.axisResistanceRecoverHoldY = Math.max(0, enemy.axisResistanceRecoverHoldY - delta);
    } else {
        const nextElapsedY = Math.min(recoverySeconds, enemy.axisResistanceRecoverElapsedY + delta);
        enemy.axisResistanceRecoverElapsedY = nextElapsedY;
        const ty = recoverySeconds <= AXIS_RESISTANCE_EPSILON ? 1 : (nextElapsedY / recoverySeconds);
        const smoothY = ty * ty * (3 - (2 * ty));
        const startY = Number.isFinite(enemy.axisResistanceRecoverStartY) ? enemy.axisResistanceRecoverStartY : enemy.axisResistanceY;
        enemy.axisResistanceY = startY + ((1 - startY) * smoothY);
        if ((1 - enemy.axisResistanceY) <= AXIS_RESISTANCE_EPSILON || ty >= 1) {
            enemy.axisResistanceY = 1;
            enemy.axisResistanceRecoverStartY = 1;
            enemy.axisResistanceRecoverElapsedY = recoverySeconds;
        }
    }
}

/**
 * 회전 반동 감쇠를 메인 시뮬레이션과 같은 방식으로 적용합니다.
 * @param {object} enemy
 * @param {number} delta
 */
export function updateShadowEnemyAngularMotion(enemy, delta) {
    if (!Number.isFinite(delta) || delta <= 0 || !enemy) {
        return;
    }

    if (!Number.isFinite(enemy.angularVelocity) || enemy.angularVelocity === 0) {
        return;
    }

    if (Number.isFinite(enemy.rotation)) {
        enemy.rotation += enemy.angularVelocity * delta;
    }

    const decel = Math.max(0, Number.isFinite(enemy.angularDeceleration) ? enemy.angularDeceleration : 0);
    const step = decel * delta;
    if (step <= 0) {
        return;
    }

    if (Math.abs(enemy.angularVelocity) <= step) {
        enemy.angularVelocity = 0;
        enemy.angularDeceleration = 0;
        return;
    }

    enemy.angularVelocity -= Math.sign(enemy.angularVelocity) * step;
}

/**
 * 적 하나를 AI/충돌 이전 순수 적분 구간만큼 전진시킵니다.
 * 메인 스레드 프레임 패치가 이후에 보정하므로, 여기서는 순수 상태 머신만 재생합니다.
 * @param {object|null|undefined} enemy
 * @param {number} fixedStepSeconds
 * @param {number} fixedStepCount
 * @returns {object|null}
 */
export function advanceShadowEnemy(enemy, fixedStepSeconds, fixedStepCount) {
    if (!enemy || typeof enemy !== 'object') {
        return null;
    }

    enemy.position = enemy.position && typeof enemy.position === 'object'
        ? enemy.position
        : clonePointSnapshot(null);
    enemy.prevPosition = enemy.prevPosition && typeof enemy.prevPosition === 'object'
        ? enemy.prevPosition
        : clonePointSnapshot(enemy.position);
    enemy.renderPosition = enemy.renderPosition && typeof enemy.renderPosition === 'object'
        ? enemy.renderPosition
        : clonePointSnapshot(enemy.position);
    enemy.speed = enemy.speed && typeof enemy.speed === 'object'
        ? enemy.speed
        : clonePointSnapshot(null);
    enemy.acc = enemy.acc && typeof enemy.acc === 'object'
        ? enemy.acc
        : clonePointSnapshot(null);
    if (!enemy.status || typeof enemy.status !== 'object') {
        enemy.status = {
            id: null,
            type: 'none',
            time: 0,
            remainingTime: 0,
            factor: {}
        };
    }
    if (enemy.active === false) {
        return enemy;
    }

    const moveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : 0;
    const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
    for (let stepIndex = 0; stepIndex < fixedStepCount; stepIndex++) {
        enemy.prevPosition.x = enemy.position.x;
        enemy.prevPosition.y = enemy.position.y;

        if (enemy.status && enemy.status.remainingTime > 0) {
            enemy.status.remainingTime = Math.max(0, enemy.status.remainingTime - fixedStepSeconds);
            if (enemy.status.remainingTime === 0) {
                clearShadowEnemyStatus(enemy);
            }
        }

        recoverShadowEnemyAxisResistance(enemy, fixedStepSeconds);

        enemy.speed.x += enemy.acc.x * accSpeed * fixedStepSeconds;
        enemy.speed.y += enemy.acc.y * accSpeed * fixedStepSeconds;
        enemy.position.x += enemy.speed.x * enemy.axisResistanceX * moveSpeed * fixedStepSeconds;
        enemy.position.y += enemy.speed.y * enemy.axisResistanceY * moveSpeed * fixedStepSeconds;

        updateShadowEnemyAngularMotion(enemy, fixedStepSeconds);
    }

    enemy.renderPosition.x = enemy.position.x;
    enemy.renderPosition.y = enemy.position.y;

    return enemy;
}

/**
 * 투사체 하나를 지정한 고정 스텝 횟수만큼 전진시킵니다.
 * @param {object|null|undefined} projectile
 * @param {number} fixedStepSeconds
 * @param {number} fixedStepCount
 * @returns {object|null}
 */
export function advanceShadowProjectile(projectile, fixedStepSeconds, fixedStepCount) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    projectile.position = projectile.position && typeof projectile.position === 'object'
        ? projectile.position
        : clonePointSnapshot(null);
    projectile.prevPosition = projectile.prevPosition && typeof projectile.prevPosition === 'object'
        ? projectile.prevPosition
        : clonePointSnapshot(projectile.position);
    projectile.speed = projectile.speed && typeof projectile.speed === 'object'
        ? projectile.speed
        : clonePointSnapshot(null);

    if (projectile.active === false) {
        return projectile;
    }

    for (let stepIndex = 0; stepIndex < fixedStepCount; stepIndex++) {
        projectile.prevPosition.x = projectile.position.x;
        projectile.prevPosition.y = projectile.position.y;
        projectile.position.x += projectile.speed.x * fixedStepSeconds;
        projectile.position.y += projectile.speed.y * fixedStepSeconds;
    }

    return projectile;
}

/**
 * 충돌 저항을 즉시 낮추고 복구 타이머를 갱신합니다.
 * @param {object|null|undefined} enemy
 * @param {number} [factorX=1]
 * @param {number} [factorY=1]
 */
export function applyShadowEnemyAxisResistance(enemy, factorX = 1, factorY = 1) {
    if (!enemy || typeof enemy !== 'object') {
        return;
    }

    const fx = Number.isFinite(factorX) ? Math.max(0, Math.min(1, factorX)) : 1;
    const fy = Number.isFinite(factorY) ? Math.max(0, Math.min(1, factorY)) : 1;
    const currentX = Number.isFinite(enemy.axisResistanceX) ? enemy.axisResistanceX : 1;
    const currentY = Number.isFinite(enemy.axisResistanceY) ? enemy.axisResistanceY : 1;
    const nextX = Math.min(currentX, fx);
    const nextY = Math.min(currentY, fy);
    const recoverSeconds = Number.isFinite(enemy.axisResistanceRecoverySeconds) && enemy.axisResistanceRecoverySeconds > 0
        ? enemy.axisResistanceRecoverySeconds
        : DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS;
    const recoverDelay = Number.isFinite(enemy.axisResistanceRecoverDelaySeconds) && enemy.axisResistanceRecoverDelaySeconds > 0
        ? enemy.axisResistanceRecoverDelaySeconds
        : 0;

    if (nextX < (currentX - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceX = nextX;
        enemy.axisResistanceRecoverStartX = nextX;
        enemy.axisResistanceRecoverElapsedX = 0;
    }
    if (nextY < (currentY - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceY = nextY;
        enemy.axisResistanceRecoverStartY = nextY;
        enemy.axisResistanceRecoverElapsedY = 0;
    }

    if (nextX < (1 - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceRecoverHoldX = recoverDelay;
        enemy.axisResistanceRecoverElapsedX = Math.min(
            Number.isFinite(enemy.axisResistanceRecoverElapsedX) ? enemy.axisResistanceRecoverElapsedX : 0,
            recoverSeconds
        );
    }
    if (nextY < (1 - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceRecoverHoldY = recoverDelay;
        enemy.axisResistanceRecoverElapsedY = Math.min(
            Number.isFinite(enemy.axisResistanceRecoverElapsedY) ? enemy.axisResistanceRecoverElapsedY : 0,
            recoverSeconds
        );
    }
}

/**
 * 투사체 피격 카운트를 반영합니다.
 * @param {object|null|undefined} enemy
 * @returns {boolean}
 */
export function registerShadowEnemyProjectileHit(enemy) {
    if (!enemy || typeof enemy !== 'object') {
        return false;
    }

    const threshold = Number.isFinite(enemy.projectileHitsToKill)
        ? Math.max(0, Math.floor(enemy.projectileHitsToKill))
        : 0;
    if (threshold <= 0) {
        return false;
    }

    enemy.projectileHitCount = (Number.isFinite(enemy.projectileHitCount) ? enemy.projectileHitCount : 0) + 1;
    if (enemy.projectileHitCount < threshold) {
        return false;
    }

    enemy.active = false;
    return true;
}

/**
 * 적 회전 반동을 반영합니다.
 * @param {object|null|undefined} enemy
 * @param {number} impulse
 * @param {number} [decaySeconds=1]
 */
export function addShadowEnemyAngularImpulse(enemy, impulse, decaySeconds = 1) {
    if (!enemy || typeof enemy !== 'object' || !Number.isFinite(impulse) || impulse === 0) {
        return;
    }

    const rotationResistance = Math.max(
        1,
        Number.isFinite(enemy.rotationResistance) ? enemy.rotationResistance : 1
    );
    enemy.angularVelocity = Number.isFinite(enemy.angularVelocity) ? enemy.angularVelocity : 0;
    enemy.angularVelocity += impulse / rotationResistance;
    if (enemy.angularVelocity > MAX_SHADOW_ANGULAR_VELOCITY) enemy.angularVelocity = MAX_SHADOW_ANGULAR_VELOCITY;
    if (enemy.angularVelocity < -MAX_SHADOW_ANGULAR_VELOCITY) enemy.angularVelocity = -MAX_SHADOW_ANGULAR_VELOCITY;
    const safeDecay = Math.max(0.016, Number.isFinite(decaySeconds) ? decaySeconds : 1);
    enemy.angularDeceleration = Math.abs(enemy.angularVelocity) / safeDecay;
}
