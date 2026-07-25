const EPSILON = 1e-6;

/**
 * 벽 객체를 축 정렬 사각형 경계로 변환합니다.
 * @param {object|null|undefined} wall - 벽 객체입니다.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null} 사각형 경계입니다.
 */
export const getRectBounds = (wall) => {
    if (!wall) return null;
    const hasDirectRect = Number.isFinite(wall.x)
        && Number.isFinite(wall.y)
        && Number.isFinite(wall.w)
        && Number.isFinite(wall.h);
    const rect = hasDirectRect && (wall.kind === 'wall' || typeof wall.getCollisionRect !== 'function')
        ? wall
        : (typeof wall.getCollisionRect === 'function' ? wall.getCollisionRect() : wall);
    if (!rect) return null;
    const w = Number.isFinite(rect.w) ? rect.w : 0;
    const h = Number.isFinite(rect.h) ? rect.h : 0;
    if (w <= 0 || h <= 0) return null;
    const centered = rect.origin === 'center' || rect.isCenter === true;
    const cx = centered ? rect.x : (rect.x + (w * 0.5));
    const cy = centered ? rect.y : (rect.y + (h * 0.5));
    const hw = w * 0.5;
    const hh = h * 0.5;
    return {
        minX: cx - hw,
        maxX: cx + hw,
        minY: cy - hh,
        maxY: cy + hh
    };
};

/**
 * 벽 경계를 SoA 버퍼의 지정 위치에 기록합니다.
 * @param {object|null|undefined} wall - 벽 객체입니다.
 * @param {Float64Array} target - 경계 출력 버퍼입니다.
 * @param {number} offset - 기록 시작 위치입니다.
 * @returns {boolean} 유효한 경계를 기록했는지 여부입니다.
 */
export function writeWallBounds(wall, target, offset) {
    const bounds = getRectBounds(wall);
    if (!bounds) return false;
    target[offset] = bounds.minX;
    target[offset + 1] = bounds.maxX;
    target[offset + 2] = bounds.minY;
    target[offset + 3] = bounds.maxY;
    return true;
}

/**
 * 사각형 경계를 지정 패딩만큼 확장합니다.
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} rect - 원본 경계입니다.
 * @param {number} pad - 확장 패딩입니다.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}} 확장된 경계입니다.
 */
export const expandRect = (rect, pad) => {
    const p = Math.max(0, pad);
    return {
        minX: rect.minX - p,
        maxX: rect.maxX + p,
        minY: rect.minY - p,
        maxY: rect.maxY + p
    };
};

/**
 * 선분과 사각형의 교차 여부를 좌표 기반으로 판정합니다.
 * @param {number} startX - 시작 X 좌표입니다.
 * @param {number} startY - 시작 Y 좌표입니다.
 * @param {number} endX - 끝 X 좌표입니다.
 * @param {number} endY - 끝 Y 좌표입니다.
 * @param {number} minX - 사각형 최소 X입니다.
 * @param {number} maxX - 사각형 최대 X입니다.
 * @param {number} minY - 사각형 최소 Y입니다.
 * @param {number} maxY - 사각형 최대 Y입니다.
 * @returns {boolean} 교차 여부입니다.
 */
export const segmentIntersectsRectByCoords = (
    startX,
    startY,
    endX,
    endY,
    minX,
    maxX,
    minY,
    maxY
) => {
    let tMin = 0;
    let tMax = 1;
    const dx = endX - startX;
    const dy = endY - startY;

    if (Math.abs(dx) <= EPSILON) {
        if (startX < minX || startX > maxX) return false;
    } else {
        let txMin = (minX - startX) / dx;
        let txMax = (maxX - startX) / dx;
        if (txMin > txMax) {
            const swap = txMin;
            txMin = txMax;
            txMax = swap;
        }
        tMin = Math.max(tMin, txMin);
        tMax = Math.min(tMax, txMax);
        if (tMax < tMin) return false;
    }

    if (Math.abs(dy) <= EPSILON) {
        if (startY < minY || startY > maxY) return false;
    } else {
        let tyMin = (minY - startY) / dy;
        let tyMax = (maxY - startY) / dy;
        if (tyMin > tyMax) {
            const swap = tyMin;
            tyMin = tyMax;
            tyMax = swap;
        }
        tMin = Math.max(tMin, tyMin);
        tMax = Math.min(tMax, tyMax);
        if (tMax < tMin) return false;
    }
    return tMax >= tMin;
};
