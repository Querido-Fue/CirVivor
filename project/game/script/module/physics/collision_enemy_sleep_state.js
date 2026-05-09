/**
 * 적 충돌 sleep 상태를 갱신하고 이번 프레임 sleep 여부를 반환합니다.
 * @param {object} enemy - 상태를 확인할 적 객체입니다.
 * @param {number} delta - fixed step delta입니다.
 * @param {{epsilon:number, sleepSpeedSq:number}} options - sleep 판정 상수입니다.
 * @returns {boolean} 이번 프레임 충돌 body를 정지 상태로 다룰지 여부입니다.
 */
export function updateCollisionEnemySleepState(enemy, delta, options) {
    const epsilon = Number.isFinite(options?.epsilon) ? options.epsilon : 1e-6;
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
