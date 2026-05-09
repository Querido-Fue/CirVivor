/**
 * 각도를 라디안으로 변환합니다.
 * @param {number} degrees - 각도입니다.
 * @returns {number} 라디안 값입니다.
 */
export function toRadians(degrees) {
    return (Number.isFinite(degrees) ? degrees : 0) * (Math.PI / 180);
}

/**
 * 각도를 -180~180 범위로 정규화합니다.
 * @param {number} degrees - 원본 각도입니다.
 * @returns {number} 정규화된 각도입니다.
 */
export function normalizeDegrees(degrees) {
    if (!Number.isFinite(degrees)) {
        return 0;
    }

    let normalized = degrees % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized < -180) normalized += 360;
    return normalized;
}

/**
 * 벡터를 회전합니다.
 * @param {number} x - X 좌표입니다.
 * @param {number} y - Y 좌표입니다.
 * @param {number} radians - 회전 라디안입니다.
 * @returns {{x: number, y: number}} 회전된 좌표입니다.
 */
export function rotatePoint(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos)
    };
}
