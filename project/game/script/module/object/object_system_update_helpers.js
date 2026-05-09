/**
 * 적 목록의 렌더 보간과 화면 밖 제거를 처리합니다.
 * @param {object} options - 적 update 옵션입니다.
 * @param {object[]} options.enemies - 적 목록입니다.
 * @param {number} options.alpha - 고정 스텝 보간 계수입니다.
 * @param {number} options.ww - 시뮬레이션 월드 너비입니다.
 * @param {number} options.objectWH - 오브젝트 월드 높이입니다.
 * @param {number} options.enemyCullOutsideRatio - 화면 밖 제거 여백 비율입니다.
 * @param {(index: number) => void} options.releaseEnemyAt - 적 반납 콜백입니다.
 */
export function updateObjectSystemEnemies(options) {
    const enemies = Array.isArray(options?.enemies) ? options.enemies : [];
    const alpha = Number.isFinite(options?.alpha) ? options.alpha : 1;
    const ww = Number.isFinite(options?.ww) ? options.ww : 0;
    const objectWH = Number.isFinite(options?.objectWH) ? options.objectWH : 0;
    const enemyCullOutsideRatio = Number.isFinite(options?.enemyCullOutsideRatio)
        ? options.enemyCullOutsideRatio
        : 0;
    const releaseEnemyAt = typeof options?.releaseEnemyAt === 'function'
        ? options.releaseEnemyAt
        : null;

    if (!releaseEnemyAt) {
        return;
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (!enemy || !enemy.active) {
            releaseEnemyAt(i);
            continue;
        }

        enemy.interpolatePosition(alpha);

        if (enemy.isOutsideScreen(ww, objectWH, enemyCullOutsideRatio)) {
            releaseEnemyAt(i);
        }
    }
}
