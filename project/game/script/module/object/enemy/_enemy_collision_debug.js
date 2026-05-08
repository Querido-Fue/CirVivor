import { render } from 'display/display_system.js';
import { getSetting } from 'save/save_system.js';
import {
    getHexaHiveType,
    getHexaNormalizedRadius
} from './_hexa_hive_layout.js';

const ENEMY_PAIR_COLLISION_RADIUS_SCALE = 0.9;
const ENEMY_PROJECTILE_COLLISION_RADIUS_SCALE = 1.1;
const ENEMY_PAIR_DEBUG_STROKE = 'rgba(255, 96, 96, 0.95)';
const PROJECTILE_DEBUG_STROKE = 'rgba(64, 240, 255, 0.95)';
const ENEMY_PAIR_DEBUG_LINE_WIDTH = 1.65;
const PROJECTILE_DEBUG_LINE_WIDTH = 1.85;
const HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * 정다각형의 로컬 꼭지점 배열을 생성합니다.
 * @param {number} sides
 * @param {number} radius
 * @param {number} [rotation=-Math.PI / 2]
 * @returns {number[]}
 */
const regularPolygon = (sides, radius, rotation = -Math.PI / 2) => {
    const points = [];
    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
        const a = rotation + (i * step);
        points.push(Math.cos(a) * radius, Math.sin(a) * radius);
    }
    return points;
};

const ENEMY_LOCAL_PARTS = Object.freeze({
    square: Object.freeze([
        Object.freeze([-0.42, -0.42, 0.42, -0.42, 0.42, 0.42, -0.42, 0.42])
    ]),
    triangle: Object.freeze([
        Object.freeze([0.0, -0.5333, 0.462, 0.2667, -0.462, 0.2667])
    ]),
    arrow: Object.freeze([
        Object.freeze([0.0, -0.5767, 0.46, 0.3733, -0.46, 0.3733])
    ]),
    hexa: Object.freeze([Object.freeze(regularPolygon(6, 0.47, -Math.PI / 2))]),
    penta: Object.freeze([Object.freeze(regularPolygon(5, 0.48, -Math.PI / 2))]),
    rhom: Object.freeze([
        Object.freeze([0.0, -0.50, 0.34, 0.0, 0.0, 0.50, -0.34, 0.0])
    ]),
    octa: Object.freeze([Object.freeze(regularPolygon(8, 0.47, Math.PI / 8))]),
    gen: Object.freeze([
        Object.freeze([-0.44, -0.44, 0.44, -0.44, 0.44, 0.44, -0.44, 0.44])
    ])
});

/**
 * 로컬 다각형 점 배열을 감싸는 가상 원 반지름을 계산합니다.
 * @param {readonly number[][]} localParts
 * @param {number} widthScale
 * @param {number} heightScale
 * @returns {number}
 */
function getScaledLocalPartsMaxRadius(localParts, widthScale, heightScale) {
    let maxDistSq = 0;
    if (!Array.isArray(localParts)) {
        return 0;
    }

    for (let partIndex = 0; partIndex < localParts.length; partIndex++) {
        const part = localParts[partIndex];
        if (!Array.isArray(part)) {
            continue;
        }

        for (let i = 0; i < part.length; i += 2) {
            const x = (Number.isFinite(part[i]) ? part[i] : 0) * widthScale;
            const y = (Number.isFinite(part[i + 1]) ? part[i + 1] : 0) * heightScale;
            const distSq = (x * x) + (y * y);
            if (distSq > maxDistSq) {
                maxDistSq = distSq;
            }
        }
    }

    return Math.sqrt(maxDistSq);
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
        return (getHexaNormalizedRadius() / ENEMY_PAIR_COLLISION_RADIUS_SCALE) * Math.max(width, height);
    }

    return Math.max(
        1,
        getScaledLocalPartsMaxRadius(
            ENEMY_LOCAL_PARTS[enemyType] || ENEMY_LOCAL_PARTS.square,
            width,
            height
        )
    );
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
