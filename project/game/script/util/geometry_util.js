/**
 * 좌표가 사각형 내부에 있는지 반환합니다.
 * @param {number} x - 검사할 X 좌표입니다.
 * @param {number} y - 검사할 Y 좌표입니다.
 * @param {{x:number, y:number, w:number, h:number}|null|undefined} rect - 검사할 사각형입니다.
 * @returns {boolean} 좌표가 사각형 내부에 있으면 true입니다.
 */
export function isPointInRect(x, y, rect) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !rect) {
        return false;
    }

    const rectX = Number.isFinite(rect.x) ? rect.x : 0;
    const rectY = Number.isFinite(rect.y) ? rect.y : 0;
    const rectW = Number.isFinite(rect.w) ? rect.w : 0;
    const rectH = Number.isFinite(rect.h) ? rect.h : 0;
    return (
        x >= rectX &&
        x <= rectX + rectW &&
        y >= rectY &&
        y <= rectY + rectH
    );
}

/**
 * 축 정렬 사각형과 원이 겹치는지 반환합니다.
 * @param {{minX:number, maxX:number, minY:number, maxY:number}} rect - 축 정렬 사각 범위입니다.
 * @param {number} x - 원 중심 X 좌표입니다.
 * @param {number} y - 원 중심 Y 좌표입니다.
 * @param {number} radius - 원 반지름입니다.
 * @returns {boolean} 사각형과 원이 겹치면 true입니다.
 */
export function isRectCircleOverlapping(rect, x, y, radius) {
    if (!rect || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
        return false;
    }

    const minX = Number.isFinite(rect.minX) ? rect.minX : 0;
    const maxX = Number.isFinite(rect.maxX) ? rect.maxX : minX;
    const minY = Number.isFinite(rect.minY) ? rect.minY : 0;
    const maxY = Number.isFinite(rect.maxY) ? rect.maxY : minY;
    const closestX = Math.max(minX, Math.min(x, maxX));
    const closestY = Math.max(minY, Math.min(y, maxY));
    const dx = x - closestX;
    const dy = y - closestY;
    return ((dx * dx) + (dy * dy)) <= (radius * radius);
}
