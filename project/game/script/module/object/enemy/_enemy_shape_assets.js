import { ENEMY_SHAPE_TYPES } from 'data/object/enemy/enemy_catalog_data.js';

const ENEMY_SHAPE_KEY_PREFIX = 'enemy_';

const ENEMY_SHAPE_KEYS = Object.freeze(
    Object.fromEntries(
        ENEMY_SHAPE_TYPES.map((type) => [type, `${ENEMY_SHAPE_KEY_PREFIX}${type}`])
    )
);

/**
 * 적 타입에 대응하는 렌더 shape 키를 반환합니다.
 * @param {string} type - 적 타입입니다.
 * @returns {string} 렌더 shape 키입니다.
 */
export const getEnemyShapeKey = (type) => (
    ENEMY_SHAPE_KEYS[type] ?? `${ENEMY_SHAPE_KEY_PREFIX}${type}`
);

/**
 * WebGL shape atlas에 등록할 적 렌더 키 목록입니다.
 */
export const ENEMY_WEBGL_SHAPES = Object.freeze(
    ENEMY_SHAPE_TYPES.map((type) => ENEMY_SHAPE_KEYS[type])
);

/**
 * 다각형의 꼭짓점 좌표 배열을 생성합니다.
 * @param {number} sides - 다각형 변 개수입니다.
 * @param {number} radius - 반지름입니다.
 * @param {number} [rotation=-Math.PI / 2] - 시작 회전각입니다.
 * @returns {{x:number,y:number}[]} 좌표 목록입니다.
 */
const polygonPoints = (sides, radius, rotation = -Math.PI / 2) => {
    const points = [];
    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
        const angle = rotation + (i * step);
        points.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius
        });
    }
    return points;
};

/**
 * 좌표 목록을 닫힌 SVG path로 변환합니다.
 * @param {{x:number,y:number}[]} points - 좌표 목록입니다.
 * @returns {string} SVG path입니다.
 */
const pointsToPath = (points) => {
    if (!points || points.length === 0) return '';
    const [first, ...rest] = points;
    return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(' ')} Z`;
};

/**
 * 직사각형 SVG path를 생성합니다.
 * @param {number} x - 시작 X입니다.
 * @param {number} y - 시작 Y입니다.
 * @param {number} width - 너비입니다.
 * @param {number} height - 높이입니다.
 * @returns {string} SVG path입니다.
 */
const rectPath = (x, y, width, height) => (
    `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`
);

/**
 * SVG path 항목을 불변 목록으로 만듭니다.
 * @param {Array<string|{d:string,fillRule?:string}>} paths - path 항목입니다.
 * @returns {ReadonlyArray<string|Readonly<{d:string,fillRule?:string}>>} 불변 path 목록입니다.
 */
const freezeShapePaths = (paths) => Object.freeze(
    paths.map((path) => (
        path && typeof path === 'object'
            ? Object.freeze({ ...path })
            : path
    ))
);

/**
 * 적 렌더 키별 SVG path asset입니다.
 */
export const ENEMY_SVG_SHAPES = Object.freeze({
    enemy_square: freezeShapePaths([rectPath(-0.42, -0.42, 0.84, 0.84)]),
    enemy_triangle: freezeShapePaths([pointsToPath([
        { x: 0.0, y: -0.5333 },
        { x: 0.462, y: 0.2667 },
        { x: -0.462, y: 0.2667 }
    ])]),
    enemy_arrow: freezeShapePaths([pointsToPath([
        { x: 0.0, y: -0.5767 },
        { x: 0.46, y: 0.3733 },
        { x: 0.0, y: 0.2033 },
        { x: -0.46, y: 0.3733 }
    ])]),
    enemy_hexa: freezeShapePaths([pointsToPath(polygonPoints(6, 0.47, -Math.PI / 2))]),
    enemy_penta: freezeShapePaths([pointsToPath(polygonPoints(5, 0.48, -Math.PI / 2))]),
    enemy_rhom: freezeShapePaths([pointsToPath([
        { x: 0.0, y: -0.50 },
        { x: 0.34, y: 0.0 },
        { x: 0.0, y: 0.50 },
        { x: -0.34, y: 0.0 }
    ])]),
    enemy_octa: freezeShapePaths([pointsToPath(polygonPoints(8, 0.47, Math.PI / 8))]),
    enemy_gen: freezeShapePaths([
        {
            d: `${rectPath(-0.30, -0.30, 0.60, 0.60)} ${rectPath(-0.22, -0.22, 0.44, 0.44)}`,
            fillRule: 'evenodd'
        },
        rectPath(-0.44, -0.44, 0.10, 0.10),
        rectPath(0.34, -0.44, 0.10, 0.10),
        rectPath(0.34, 0.34, 0.10, 0.10),
        rectPath(-0.44, 0.34, 0.10, 0.10)
    ])
});
