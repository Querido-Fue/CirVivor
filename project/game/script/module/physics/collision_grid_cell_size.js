import { getSimulationObjectWH } from '../simulation/simulation_runtime.js';

const MIN_CELL_SIZE = 20;
const MAX_CELL_SIZE = 280;

/**
 * grid 용도에 맞는 평균 broad radius로 셀 크기를 추정합니다.
 * @param {object[]} bodies - 충돌 body 목록입니다.
 * @param {'default'|'enemyPair'|'projectile'} [gridMode='default'] - grid 사용 목적입니다.
 * @returns {number} broad-phase grid cell 크기입니다.
 */
export function estimateCollisionGridCellSize(bodies, gridMode = 'default') {
    let radiusSum = 0;
    let count = 0;
    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        let radius = body?.boundRadius;
        if (gridMode === 'enemyPair' && body?.kind === 'enemy') {
            radius = body.enemyPairBroadRadius;
        } else if (gridMode === 'projectile' && body?.kind === 'enemy') {
            radius = body.projectileBroadRadius;
        }
        if (!Number.isFinite(radius) || radius <= 0) continue;
        radiusSum += radius;
        count++;
    }
    const avgRadius = count > 0 ? (radiusSum / count) : Math.max(getSimulationObjectWH() * 0.015, 12);
    const cell = Math.floor(avgRadius * 2.4);
    return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, cell));
}
