/**
 * 투사체 sweep 서브스텝 위치를 원형 scratch body에 기록합니다.
 * @param {object} body - 재사용할 투사체 scratch body입니다.
 * @param {object} projectile - 검사할 투사체입니다.
 * @param {number} centerX - 서브스텝 중심 X 좌표입니다.
 * @param {number} centerY - 서브스텝 중심 Y 좌표입니다.
 * @param {number} epsilon - 최소 weight 보정값입니다.
 * @returns {object} 갱신된 scratch body입니다.
 */
export function writeCollisionProjectileSweepBody(body, projectile, centerX, centerY, epsilon) {
    const radius = Number.isFinite(projectile?.radius) ? projectile.radius : 0;
    body.x = centerX;
    body.y = centerY;
    body.centerX = centerX;
    body.centerY = centerY;
    body.radius = radius;
    body.boundRadius = radius;
    body.broadRadius = radius;
    body.circleParts = null;
    body.circlePartCount = 0;
    body.weight = Math.max(epsilon, Number.isFinite(projectile?.weight) ? projectile.weight : 1);
    body.ref = projectile;
    body.minX = centerX - radius;
    body.maxX = centerX + radius;
    body.minY = centerY - radius;
    body.maxY = centerY + radius;
    body.sweepMinX = centerX - radius;
    body.sweepMaxX = centerX + radius;
    body.sweepMinY = centerY - radius;
    body.sweepMaxY = centerY + radius;
    return body;
}
