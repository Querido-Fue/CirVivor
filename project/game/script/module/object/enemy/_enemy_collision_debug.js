import { render } from 'display/display_system.js';
import { getSetting } from 'save/save_system.js';
import {
    getHexaHiveType,
    getHexaNormalizedRadius
} from './_hexa_hive_layout.js';

const COLLISION_RADIUS_TUNING_SCALE = 0.85;
const ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE = 0.9;
const ENEMY_PROJECTILE_COLLISION_RADIUS_BASE_SCALE = 1.1;
const ENEMY_PAIR_COLLISION_RADIUS_SCALE = ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE * COLLISION_RADIUS_TUNING_SCALE;
const ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE = ENEMY_PROJECTILE_COLLISION_RADIUS_BASE_SCALE * COLLISION_RADIUS_TUNING_SCALE;
const ENEMY_PAIR_DEBUG_STROKE = 'rgba(255, 96, 96, 0.95)';
const PROJECTILE_DEBUG_STROKE = 'rgba(64, 240, 255, 0.95)';
const ENEMY_PAIR_DEBUG_LINE_WIDTH = 1.65;
const PROJECTILE_DEBUG_LINE_WIDTH = 1.85;
const HEXA_HIVE_TYPE = getHexaHiveType();
const HEXA_HIVE_CELL_COLLISION_RADIUS = getHexaNormalizedRadius() / ENEMY_PAIR_COLLISION_RADIUS_BASE_SCALE;

/**
 * 적 타입별 단일 원 충돌 반지름을 계산합니다.
 * @param {string|null|undefined} enemyType
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function getEnemyCircleCollisionRadius(enemyType, width, height) {
    const safeWidth = Number.isFinite(width) ? Math.max(1, width) : 1;
    const safeHeight = Number.isFinite(height) ? Math.max(1, height) : safeWidth;
    let radius = 0;

    switch (enemyType) {
        case 'triangle':
            radius = Math.max(
                safeHeight * 0.5333,
                Math.hypot(safeWidth * 0.462, safeHeight * 0.2667)
            );
            break;
        case 'arrow':
            radius = Math.max(
                safeHeight * 0.5767,
                Math.hypot(safeWidth * 0.46, safeHeight * 0.3733)
            );
            break;
        case 'hexa':
            radius = 0.47 * Math.max(
                safeHeight,
                Math.hypot(safeWidth * 0.8660254037844386, safeHeight * 0.5)
            );
            break;
        case 'penta':
            radius = 0.48 * Math.max(
                safeHeight,
                Math.hypot(safeWidth * 0.9510565162951535, safeHeight * 0.3090169943749474),
                Math.hypot(safeWidth * 0.5877852522924731, safeHeight * 0.8090169943749475)
            );
            break;
        case 'rhom':
            radius = Math.max(safeWidth * 0.34, safeHeight * 0.5);
            break;
        case 'octa':
            radius = 0.47 * Math.max(
                Math.hypot(safeWidth * 0.9238795325112867, safeHeight * 0.3826834323650898),
                Math.hypot(safeWidth * 0.3826834323650898, safeHeight * 0.9238795325112867)
            );
            break;
        case 'gen':
            radius = Math.hypot(safeWidth * 0.44, safeHeight * 0.44);
            break;
        case 'square':
        default:
            radius = Math.hypot(safeWidth * 0.42, safeHeight * 0.42);
            break;
    }

    return Math.max(1, radius);
}

/**
 * 로컬 좌표를 회전한 월드 오프셋으로 변환합니다.
 * @param {number} x
 * @param {number} y
 * @param {number} radians
 * @returns {{x: number, y: number}}
 */
function rotateLocalOffset(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos)
    };
}

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
    const width = Number.isFinite(options.width) ? Math.max(1, options.width) : 1;
    const height = Number.isFinite(options.height) ? Math.max(1, options.height) : width;
    const renderX = Number.isFinite(options.renderX) ? options.renderX : 0;
    const renderY = Number.isFinite(options.renderY) ? options.renderY : 0;
    const rotationRadians = Number.isFinite(options.rotationRadians) ? options.rotationRadians : 0;
    const layer = typeof options.layer === 'string' ? options.layer : 'top';
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
        const rotated = rotateLocalOffset(localX, localY, rotationRadians);
        const x = renderX + rotated.x;
        const y = renderY + rotated.y;

        drawDebugCircle(layer, x, y, projectileRadius, PROJECTILE_DEBUG_STROKE, PROJECTILE_DEBUG_LINE_WIDTH);
        drawDebugCircle(layer, x, y, enemyPairRadius, ENEMY_PAIR_DEBUG_STROKE, ENEMY_PAIR_DEBUG_LINE_WIDTH);
    }
}
