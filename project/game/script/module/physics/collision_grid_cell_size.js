import { clampNumber } from 'util/number_util.js';
import { getSimulationObjectWH } from '../simulation/simulation_runtime.js';

const MIN_CELL_SIZE = 20;
const MAX_CELL_SIZE = 280;
const CELL_SIZE_RADIUS_SCALE = 2.4;
const DEFAULT_RADIUS_WORLD_RATIO = 0.015;
const DEFAULT_RADIUS_MIN = 12;

/**
 * grid 용도에 맞는 평균 broad radius로 셀 크기를 추정합니다.
 * @param {object[]} bodies - 충돌 body 목록입니다.
 * @param {'default'|'enemyPair'|'projectile'} [gridMode='default'] - grid 사용 목적입니다.
 * @param {number} [countLimit=bodies.length] - 평균 계산에 포함할 앞쪽 body 개수입니다.
 * @returns {number} broad-phase grid cell 크기입니다.
 */
export function estimateCollisionGridCellSize(bodies, gridMode = 'default', countLimit = bodies.length) {
    let radiusSum = 0;
    let count = 0;
    const safeCountLimit = Number.isFinite(countLimit)
        ? Math.min(bodies.length, Math.max(0, Math.floor(countLimit)))
        : bodies.length;
    for (let i = 0; i < safeCountLimit; i++) {
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
    const avgRadius = count > 0
        ? (radiusSum / count)
        : Math.max(getSimulationObjectWH() * DEFAULT_RADIUS_WORLD_RATIO, DEFAULT_RADIUS_MIN);
    const cell = Math.floor(avgRadius * CELL_SIZE_RADIUS_SCALE);
    return clampNumber(cell, MIN_CELL_SIZE, MAX_CELL_SIZE);
}
