/**
 * 육각형 합체 적 레이아웃 계산에 사용하는 정적 데이터입니다.
 */
/** 육각형 셀의 정규화 반경입니다. */
const HEXA_HIVE_NORMALIZED_RADIUS = 0.47;

/** 육각형 꼭짓점 각도 계산에 사용하는 30도 라디안 단위입니다. */
const HEXA_VERTEX_ANGLE_UNIT = Math.PI / 6;

export const HEXA_HIVE_LAYOUT_DATA = Object.freeze({
    SCHEMA_VERSION: 1,
    TYPE: 'hexa_hive',
    NORMALIZED_RADIUS: HEXA_HIVE_NORMALIZED_RADIUS,
    FRONT_RENDER_SCALE: 0.9,
    BACKDROP_RENDER_SCALE: 1.14,
    OUTLINE_THICKNESS_RATIO: 0.12,
    EPSILON: 1e-6,
    VERTEX_KEY_SCALE: 10000,
    AXIAL_DIRECTIONS: Object.freeze([
        Object.freeze({ q: 1, r: 0 }),
        Object.freeze({ q: 1, r: -1 }),
        Object.freeze({ q: 0, r: -1 }),
        Object.freeze({ q: -1, r: 0 }),
        Object.freeze({ q: -1, r: 1 }),
        Object.freeze({ q: 0, r: 1 })
    ]),
    EXPOSED_EDGE_DIRECTIONS: Object.freeze([
        Object.freeze({ q: 1, r: -1 }),
        Object.freeze({ q: 1, r: 0 }),
        Object.freeze({ q: 0, r: 1 }),
        Object.freeze({ q: -1, r: 1 }),
        Object.freeze({ q: -1, r: 0 }),
        Object.freeze({ q: 0, r: -1 })
    ]),
    LOCAL_VERTICES: Object.freeze([
        Object.freeze({ x: 0, y: -HEXA_HIVE_NORMALIZED_RADIUS }),
        Object.freeze({
            x: Math.cos(-HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS,
            y: Math.sin(-HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS
        }),
        Object.freeze({
            x: Math.cos(HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS,
            y: Math.sin(HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS
        }),
        Object.freeze({ x: 0, y: HEXA_HIVE_NORMALIZED_RADIUS }),
        Object.freeze({
            x: Math.cos(5 * HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS,
            y: Math.sin(5 * HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS
        }),
        Object.freeze({
            x: Math.cos(7 * HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS,
            y: Math.sin(7 * HEXA_VERTEX_ANGLE_UNIT) * HEXA_HIVE_NORMALIZED_RADIUS
        })
    ])
});
