import { getData } from 'data/data_handler.js';
import { getSimulationObjectWH } from '../simulation/simulation_runtime.js';

const COLLISION_GRID_CONSTANTS = getData('COLLISION_CONSTANTS').GRID;
const MIN_CELL_SIZE = COLLISION_GRID_CONSTANTS.MIN_CELL_SIZE;
const MAX_CELL_SIZE = COLLISION_GRID_CONSTANTS.MAX_CELL_SIZE;
const CELL_SIZE_RADIUS_SCALE = COLLISION_GRID_CONSTANTS.CELL_SIZE_RADIUS_SCALE;
const DEFAULT_RADIUS_WORLD_RATIO = COLLISION_GRID_CONSTANTS.DEFAULT_RADIUS_WORLD_RATIO;
const DEFAULT_RADIUS_MIN = COLLISION_GRID_CONSTANTS.DEFAULT_RADIUS_MIN;

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
    const avgRadius = count > 0
        ? (radiusSum / count)
        : Math.max(getSimulationObjectWH() * DEFAULT_RADIUS_WORLD_RATIO, DEFAULT_RADIUS_MIN);
    const cell = Math.floor(avgRadius * CELL_SIZE_RADIUS_SCALE);
    return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, cell));
}
