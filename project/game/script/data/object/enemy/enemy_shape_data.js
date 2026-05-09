/**
 * 적을 렌더링할 때 화면 높이에 대비한 비율 상향치
 */
export const ENEMY_DRAW_HEIGHT_RATIO = 0.03;

/** 적 WebGL 스프라이트 키를 만들 때 사용하는 접두사입니다. */
const ENEMY_SHAPE_KEY_PREFIX = 'enemy_';

/**
 * 게임 내 적의 형태 종류 목록
 */
export const ENEMY_SHAPE_TYPES = Object.freeze([
    'square',
    'triangle',
    'arrow',
    'hexa',
    'penta',
    'rhom',
    'octa',
    'gen'
]);

/**
 * 각 적 형태별 종횡비 (너비/높이)
 */
export const ENEMY_ASPECT_RATIO = Object.freeze({
    square: 1.0,
    triangle: 1.0,
    arrow: 0.96,
    hexa: 1.0,
    penta: 1.0,
    rhom: 0.81,
    octa: 1.0,
    gen: 1.05
});

/**
 * 각 적 형태별 렌더링 높이 보정 비율
 */
export const ENEMY_HEIGHT_SCALE = Object.freeze({
    square: 1.0,
    triangle: 1.0,
    arrow: 0.9,
    hexa: 1.0,
    penta: 1.0,
    rhom: 1.0,
    octa: 1.0,
    gen: 1.0
});

/**
 * 적 형태별 기본 무게
 */
export const ENEMY_DEFAULT_WEIGHT = Object.freeze({
    square: 1,
    triangle: 0.6,
    arrow: 0.6,
    rhom: 0.6,
    hexa: 1.5,
    penta: 1.2,
    octa: 2.5,
    gen: 4
});

/**
 * 적 형태별 단일 원 충돌 반경 계산 데이터입니다.
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
        gen: Object.freeze({
            vectors: Object.freeze([
                Object.freeze({ x: 0.44, y: 0.44 })
            ])
        })
    })
});

/**
 * 적 타입별 WebGL 스프라이트 키 캐시
 */
export const ENEMY_SHAPE_KEYS = Object.freeze(
    Object.fromEntries(
        ENEMY_SHAPE_TYPES.map((type) => [type, `${ENEMY_SHAPE_KEY_PREFIX}${type}`])
    )
);

/**
 * 특정 형태 종류를 기반으로 적의 스프라이트 키를 반환합니다.
 * @param {string} type 적 형태 종류 (예: 'square', 'hexa')
 * @returns {string} 스프라이트 식별용 키
 */
export const getEnemyShapeKey = (type) => {
    return ENEMY_SHAPE_KEYS[type] ?? `${ENEMY_SHAPE_KEY_PREFIX}${type}`;
};

/**
 * WebGL 렌더링에 사용되는 적의 모든 형태 키 목록
 */
export const ENEMY_WEBGL_SHAPES = Object.freeze(
    ENEMY_SHAPE_TYPES.map((type) => ENEMY_SHAPE_KEYS[type])
);
