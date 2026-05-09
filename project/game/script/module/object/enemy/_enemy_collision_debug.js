import { getData } from 'data/data_handler.js';
import { render } from 'display/display_system.js';
import {
    ENEMY_PAIR_COLLISION_RADIUS_SCALE,
    ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE,
    HEXA_HIVE_CELL_COLLISION_RADIUS
} from 'physics/_collision_resolve_tuning.js';
import { getEnemyCircleCollisionRadius } from 'physics/_collision_enemy_geometry.js';
import { getSetting } from 'save/save_system.js';
import {
    getHexaHiveType
} from './_hexa_hive_layout.js';
import { rotatePoint } from './_hexa_hive_layout_math.js';

const ENEMY_COLLISION_DEBUG_CONSTANTS = getData('ENEMY_CONSTANTS').COLLISION_DEBUG;
const ENEMY_COLLISION_RADIUS_DATA = getData('ENEMY_COLLISION_RADIUS_DATA');
const ENEMY_PAIR_DEBUG_STROKE = ENEMY_COLLISION_DEBUG_CONSTANTS.ENEMY_PAIR_STROKE;
const PROJECTILE_DEBUG_STROKE = ENEMY_COLLISION_DEBUG_CONSTANTS.PROJECTILE_STROKE;
const ENEMY_PAIR_DEBUG_LINE_WIDTH = ENEMY_COLLISION_DEBUG_CONSTANTS.ENEMY_PAIR_LINE_WIDTH;
const PROJECTILE_DEBUG_LINE_WIDTH = ENEMY_COLLISION_DEBUG_CONSTANTS.PROJECTILE_LINE_WIDTH;
const DEFAULT_DEBUG_LAYER = ENEMY_COLLISION_DEBUG_CONSTANTS.DEFAULT_LAYER;
const MIN_COLLISION_DIMENSION = ENEMY_COLLISION_RADIUS_DATA.MIN_DIMENSION;
const HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * 적 타입별 기본 충돌 원 반경을 반환합니다.
 * @param {string} enemyType
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function getEnemyBaseCollisionRadius(enemyType, width, height) {
    if (enemyType === HEXA_HIVE_TYPE) {
        return HEXA_HIVE_CELL_COLLISION_RADIUS * Math.max(width, height);
    }

    return getEnemyCircleCollisionRadius(enemyType, width, height);
}

/**
 * 디버그 원을 그립니다.
 * @param {string} layer
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {string} stroke
 * @param {number} lineWidth
 */
function drawDebugCircle(layer, x, y, radius, stroke, lineWidth) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) {
        return;
    }

    render(layer, {
        shape: 'circle',
        x,
        y,
        radius,
        fill: false,
        stroke,
        lineWidth,
        alpha: 1
    });
}

/**
 * 디버그 모드에서 적 충돌 기준 원을 렌더링합니다.
 * @param {{enemyType?: string, localCenters?: {x?: number, y?: number}[]|null, width?: number, height?: number, rotationRadians?: number, renderX?: number, renderY?: number, layer?: string}} options
 */
export function drawEnemyCollisionDebugCircles(options = {}) {
    if (getSetting('debugMode') !== true) {
        return;
    }

    const enemyType = typeof options.enemyType === 'string' ? options.enemyType : 'square';
    const width = Number.isFinite(options.width)
        ? Math.max(MIN_COLLISION_DIMENSION, options.width)
        : MIN_COLLISION_DIMENSION;
    const height = Number.isFinite(options.height)
        ? Math.max(MIN_COLLISION_DIMENSION, options.height)
        : width;
    const renderX = Number.isFinite(options.renderX) ? options.renderX : 0;
    const renderY = Number.isFinite(options.renderY) ? options.renderY : 0;
    const rotationRadians = Number.isFinite(options.rotationRadians) ? options.rotationRadians : 0;
    const layer = typeof options.layer === 'string' ? options.layer : DEFAULT_DEBUG_LAYER;
    const isHive = enemyType === HEXA_HIVE_TYPE;
    const centers = isHive
        ? (Array.isArray(options.localCenters) ? options.localCenters : null)
        : [{ x: 0, y: 0 }];

    if (!Array.isArray(centers) || centers.length === 0) {
        return;
    }

    const baseRadius = getEnemyBaseCollisionRadius(enemyType, width, height);
    const projectileRadius = baseRadius * ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE;
    const enemyPairRadius = baseRadius * ENEMY_PAIR_COLLISION_RADIUS_SCALE;

    for (let i = 0; i < centers.length; i++) {
        const localCenter = centers[i];
        if (!localCenter) {
            continue;
        }

        const localX = (Number.isFinite(localCenter.x) ? localCenter.x : 0) * width;
        const localY = (Number.isFinite(localCenter.y) ? localCenter.y : 0) * height;
        const rotated = rotatePoint(localX, localY, rotationRadians);
        const x = renderX + rotated.x;
        const y = renderY + rotated.y;

        drawDebugCircle(layer, x, y, projectileRadius, PROJECTILE_DEBUG_STROKE, PROJECTILE_DEBUG_LINE_WIDTH);
        drawDebugCircle(layer, x, y, enemyPairRadius, ENEMY_PAIR_DEBUG_STROKE, ENEMY_PAIR_DEBUG_LINE_WIDTH);
    }
}
