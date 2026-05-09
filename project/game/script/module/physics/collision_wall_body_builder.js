import { createCollisionWallBody } from './collision_scratch_objects.js';

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

        const rect = typeof wall.getCollisionRect === 'function' ? wall.getCollisionRect() : wall;
        if (!rect) {
            continue;
        }

        const w = Number.isFinite(rect.w) ? rect.w : 0;
        const h = Number.isFinite(rect.h) ? rect.h : 0;
        if (w <= 0 || h <= 0) {
            continue;
        }

        out.push(createCollisionWallBody(rect, wall));
    }

    return out;
}
