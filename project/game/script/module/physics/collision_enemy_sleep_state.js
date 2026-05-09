import { getData } from 'data/data_handler.js';

const DEFAULT_EPSILON = getData('COLLISION_CONSTANTS').EPSILON;

/**
 * 적 충돌 sleep 상태를 갱신하고 이번 프레임 sleep 여부를 반환합니다.
 * @param {object} enemy - 상태를 확인할 적 객체입니다.
 * @param {number} delta - fixed step delta입니다.
 * @param {{epsilon:number, sleepSpeedSq:number}} options - sleep 판정 상수입니다.
 * @returns {boolean} 이번 프레임 충돌 body를 정지 상태로 다룰지 여부입니다.
 */
export function updateCollisionEnemySleepState(enemy, delta, options) {
    const epsilon = Number.isFinite(options?.epsilon) ? options.epsilon : DEFAULT_EPSILON;
    const sleepSpeedSq = Number.isFinite(options?.sleepSpeedSq) ? options.sleepSpeedSq : 0;
    const prevX = Number.isFinite(enemy.__collisionPrevX) ? enemy.__collisionPrevX : enemy.position.x;
    const prevY = Number.isFinite(enemy.__collisionPrevY) ? enemy.__collisionPrevY : enemy.position.y;
    const speedX = (enemy.position.x - prevX) / Math.max(epsilon, delta);
    const speedY = (enemy.position.y - prevY) / Math.max(epsilon, delta);
    const speedSq = (speedX * speedX) + (speedY * speedY);
    const sleepTicks = Number.isFinite(enemy.__collisionSleepTicks) ? enemy.__collisionSleepTicks : 0;
    const sleeping = sleepTicks > 0 && speedSq <= sleepSpeedSq;
    if (sleeping) {
        enemy.__collisionSleepTicks = sleepTicks - 1;
    }

    return sleeping;
}

/**
 * 충돌 해소 후 적의 sleep/idle 추적 상태를 갱신합니다.
 * @param {object} enemy - 상태를 갱신할 적 객체입니다.
 * @param {object} collisionBody - 이번 프레임에 사용한 충돌 body입니다.
 * @param {{idleTicksToSleep:number, sleepTicks:number}} options - sleep 전환 설정입니다.
 */
export function updateCollisionEnemyPostSolveSleepState(enemy, collisionBody, options) {
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

    const idleTicksToSleep = Number.isFinite(options?.idleTicksToSleep) ? options.idleTicksToSleep : 0;
    const sleepTicks = Number.isFinite(options?.sleepTicks) ? options.sleepTicks : 0;
    const idleTicks = (enemy.__collisionIdleTicks || 0) + 1;
    enemy.__collisionIdleTicks = idleTicks;
    if (idleTicks >= idleTicksToSleep) {
        enemy.__collisionSleepTicks = sleepTicks;
    }
}
