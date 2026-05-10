import { createCollisionWallBody } from './collision_scratch_objects.js';

/**
 * 벽 객체에서 충돌 rect를 조회합니다.
 * @param {object} wall - 원본 벽 객체입니다.
 * @returns {object|null|undefined} 충돌 rect입니다.
 */
function getCollisionWallRect(wall) {
    return typeof wall?.getCollisionRect === 'function' ? wall.getCollisionRect() : wall;
}

/**
 * 충돌 rect가 양수 크기를 가지는지 반환합니다.
 * @param {object|null|undefined} rect - 검사할 충돌 rect입니다.
 * @returns {boolean} 충돌 body 생성 대상이면 true입니다.
 */
function hasPositiveCollisionWallRectSize(rect) {
    const w = Number.isFinite(rect?.w) ? rect.w : 0;
    const h = Number.isFinite(rect?.h) ? rect.h : 0;
    return w > 0 && h > 0;
}

/**
 * 현재 벽 목록을 충돌 rect body 배열로 다시 씁니다.
 * @param {object[]} out - 재사용할 wall body 출력 배열입니다.
 * @param {object[]} walls - 원본 벽 목록입니다.
 * @returns {object[]} 재구성된 wall body 배열입니다.
 */
export function writeCollisionWallBodies(out, walls) {
    out.length = 0;
    if (!Array.isArray(walls) || walls.length === 0) {
        return out;
    }

    for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (!wall) {
            continue;
        }

        const rect = getCollisionWallRect(wall);
        if (!hasPositiveCollisionWallRectSize(rect)) {
            continue;
        }

        out.push(createCollisionWallBody(rect, wall));
    }

    return out;
}
