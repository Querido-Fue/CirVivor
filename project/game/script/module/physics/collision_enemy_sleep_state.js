import { getData } from 'data/data_handler.js';

const DEFAULT_EPSILON = getData('COLLISION_CONSTANTS').EPSILON;

/**
 * 적 충돌 sleep 상태를 변경하지 않고 이번 프레임 sleep 여부를 계산합니다.
 * @param {object} enemy - 상태를 확인할 적 객체입니다.
 * @param {number} delta - fixed step delta입니다.
 * @param {number} [epsilon=DEFAULT_EPSILON] - 속도 계산 최소 delta입니다.
 * @param {number} [sleepSpeedSq=0] - sleep 유지 속도 제곱 상한입니다.
 * @returns {boolean} 이번 프레임 충돌 body를 정지 상태로 다룰지 여부입니다.
 */
export function readCollisionEnemySleepState(enemy, delta, epsilon = DEFAULT_EPSILON, sleepSpeedSq = 0) {
    const safeEpsilon = Number.isFinite(epsilon) ? epsilon : DEFAULT_EPSILON;
    const safeSleepSpeedSq = Number.isFinite(sleepSpeedSq) ? sleepSpeedSq : 0;
    const prevX = Number.isFinite(enemy.__collisionPrevX) ? enemy.__collisionPrevX : enemy.position.x;
    const prevY = Number.isFinite(enemy.__collisionPrevY) ? enemy.__collisionPrevY : enemy.position.y;
    const speedX = (enemy.position.x - prevX) / Math.max(safeEpsilon, delta);
    const speedY = (enemy.position.y - prevY) / Math.max(safeEpsilon, delta);
    const speedSq = (speedX * speedX) + (speedY * speedY);
    const sleepTicks = Number.isFinite(enemy.__collisionSleepTicks) ? enemy.__collisionSleepTicks : 0;
    return sleepTicks > 0 && speedSq <= safeSleepSpeedSq;
}

/**
 * 미리 계산한 sleep snapshot을 fixed tick에서 한 번만 전진시킵니다.
 * @param {object} enemy - 상태를 전진할 적 객체입니다.
 * @param {boolean} sleeping - read 단계에서 계산한 sleep 여부입니다.
 */
export function advanceCollisionEnemySleepState(enemy, sleeping) {
    if (!sleeping) {
        return;
    }

    const sleepTicks = Number.isFinite(enemy.__collisionSleepTicks) ? enemy.__collisionSleepTicks : 0;
    if (sleepTicks > 0) {
        enemy.__collisionSleepTicks = sleepTicks - 1;
    }
}

/**
 * 충돌 해소 후 적의 sleep/idle 추적 상태를 갱신합니다.
 * @param {object} enemy - 상태를 갱신할 적 객체입니다.
 * @param {object} collisionBody - 이번 프레임에 사용한 충돌 body입니다.
 * @param {number} idleTicksToSleep - sleep 전환 전 idle tick 수입니다.
 * @param {number} sleepTicks - sleep 상태 유지 tick 수입니다.
 */
export function updateCollisionEnemyPostSolveSleepState(
    enemy,
    collisionBody,
    idleTicksToSleep,
    sleepTicks
) {
    if (!enemy?.position || !collisionBody) {
        return;
    }

    enemy.__collisionPrevX = enemy.position.x;
    enemy.__collisionPrevY = enemy.position.y;
    if (collisionBody._candidatePairCount > 0 || collisionBody._resolvedPairCount > 0) {
        enemy.__collisionIdleTicks = 0;
        enemy.__collisionSleepTicks = 0;
        return;
    }

    const safeIdleTicksToSleep = Number.isFinite(idleTicksToSleep) ? idleTicksToSleep : 0;
    const safeSleepTicks = Number.isFinite(sleepTicks) ? sleepTicks : 0;
    const idleTicks = (enemy.__collisionIdleTicks || 0) + 1;
    enemy.__collisionIdleTicks = idleTicks;
    if (idleTicks >= safeIdleTicksToSleep) {
        enemy.__collisionSleepTicks = safeSleepTicks;
    }
}
