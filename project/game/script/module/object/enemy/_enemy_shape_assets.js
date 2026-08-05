import { ENEMY_SHAPE_TYPES } from 'data/object/enemy/enemy_catalog_data.js';
import {
    ENEMY_SHAPE_GEOMETRY,
    ENEMY_SHAPE_PATH_KIND
} from 'data/object/enemy/enemy_shape_geometry_data.js';

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
 * data-layer path descriptor를 SVG path 문자열로 변환합니다.
 * @param {object} path - 적 shape path descriptor입니다.
 * @returns {string} SVG path입니다.
 */
const shapePathToSvg = (path) => {
    if (path.kind === ENEMY_SHAPE_PATH_KIND.POLYGON) {
        return pointsToPath(path.points);
    }
    if (path.kind === ENEMY_SHAPE_PATH_KIND.RECT) {
        return rectPath(path.x, path.y, path.width, path.height);
    }
    if (path.kind === ENEMY_SHAPE_PATH_KIND.COMPOUND) {
        return path.paths.map(shapePathToSvg).join(' ');
    }
    throw new Error(`지원하지 않는 enemy shape path kind입니다: ${path.kind}`);
};

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

/** 적 렌더 키별 SVG path asset입니다. */
export const ENEMY_SVG_SHAPES = Object.freeze(Object.fromEntries(
    ENEMY_SHAPE_TYPES.map((type) => {
        const geometry = ENEMY_SHAPE_GEOMETRY[type];
        if (!geometry) {
            throw new Error(`enemy shape geometry가 없습니다: ${type}`);
        }
        const paths = geometry.paths.map((path) => {
            const d = shapePathToSvg(path);
            return path.fillRule ? { d, fillRule: path.fillRule } : d;
        });
        return [ENEMY_SHAPE_KEYS[type], freezeShapePaths(paths)];
    })
));
