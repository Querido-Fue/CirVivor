export {
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE
} from './enemy_shape_geometry_data.js';

/**
 * 적을 렌더링할 때 화면 높이에 적용하는 기본 비율입니다.
 */
export const ENEMY_DRAW_HEIGHT_RATIO = 0.03;

/**
 * 기본 단일 형상 적 타입 목록입니다.
 */
export const ENEMY_SHAPE_TYPES = Object.freeze([
    'square',
    'triangle',
    'arrow',
    'hexa',
    'penta',
    'rhom',
    'octa',
    'gen',
    'jorang'
]);

/**
 * 여러 육각 셀이 합쳐진 적 타입입니다.
 */
export const HEXA_HIVE_ENEMY_TYPE = 'hexa_hive';

/**
 * 적 타입별 기본 충돌 무게입니다.
 */
export const ENEMY_DEFAULT_WEIGHT = Object.freeze({
    square: 1,
    triangle: 0.6,
    arrow: 0.6,
    rhom: 0.6,
    hexa: 1.5,
    penta: 1.2,
    octa: 2.5,
    cork: 4,
    gen: 4,
    jorang: 4
});

/**
 * 적 타입별 단일 원 충돌 형상 데이터입니다.
 */
export const ENEMY_COLLISION_RADIUS_DATA = Object.freeze({
    MIN_DIMENSION: 1,
    DEFAULT_TYPE: 'square',
    TYPES: Object.freeze({
        square: Object.freeze({
            vectors: Object.freeze([
                Object.freeze({ x: 0.42, y: 0.42 })
            ])
        }),
        triangle: Object.freeze({
            heightScales: Object.freeze([0.5333]),
            vectors: Object.freeze([
                Object.freeze({ x: 0.462, y: 0.2667 })
            ])
        }),
        arrow: Object.freeze({
            heightScales: Object.freeze([0.5767]),
            vectors: Object.freeze([
                Object.freeze({ x: 0.46, y: 0.3733 })
            ])
        }),
        hexa: Object.freeze({
            scale: 0.47,
            heightScales: Object.freeze([1]),
            vectors: Object.freeze([
                Object.freeze({ x: 0.8660254037844386, y: 0.5 })
            ])
        }),
        penta: Object.freeze({
            scale: 0.48,
            heightScales: Object.freeze([1]),
            vectors: Object.freeze([
                Object.freeze({ x: 0.9510565162951535, y: 0.3090169943749474 }),
                Object.freeze({ x: 0.5877852522924731, y: 0.8090169943749475 })
            ])
        }),
        rhom: Object.freeze({
            widthScales: Object.freeze([0.34]),
            heightScales: Object.freeze([0.5])
        }),
        octa: Object.freeze({
            scale: 0.47,
            vectors: Object.freeze([
                Object.freeze({ x: 0.9238795325112867, y: 0.3826834323650898 }),
                Object.freeze({ x: 0.3826834323650898, y: 0.9238795325112867 })
            ])
        }),
        cork: Object.freeze({
            vectors: Object.freeze([
                Object.freeze({ x: 0.48, y: 0.46 })
            ])
        }),
        gen: Object.freeze({
            vectors: Object.freeze([
                Object.freeze({ x: 0.44, y: 0.44 })
            ])
        }),
        jorang: Object.freeze({
            vectors: Object.freeze([
                Object.freeze({ x: 0.40, y: 0.46 })
            ])
        })
    })
});
