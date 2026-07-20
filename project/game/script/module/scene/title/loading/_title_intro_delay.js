/**
 * 타이틀 인트로 시작 지연 시간축을 한 프레임 전진합니다.
 * 비정상·음수 delta는 시간을 진행하지 않으며 delay에 도달한 뒤에는 값을 고정합니다.
 * @param {number} elapsed - 기존 누적 시간입니다.
 * @param {number} delta - 현재 가변 프레임 delta입니다.
 * @param {number} delay - 인트로 시작 지연 시간입니다.
 * @returns {{elapsed:number,ready:boolean}} 갱신된 누적 시간과 시작 가능 여부입니다.
 */
export function advanceTitleIntroDelay(elapsed, delta, delay) {
    const resolvedDelay = Number.isFinite(delay) && delay > 0 ? delay : 0;
    const resolvedElapsed = Number.isFinite(elapsed) && elapsed > 0
        ? Math.min(elapsed, resolvedDelay)
        : 0;
    const resolvedDelta = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const nextElapsed = Math.min(resolvedDelay, resolvedElapsed + resolvedDelta);
    return {
        elapsed: nextElapsed,
        ready: nextElapsed >= resolvedDelay
    };
}
