/**
 * 육각형 합체 적 레이아웃 계산에 사용하는 정적 데이터입니다.
 */
export const HEXA_HIVE_LAYOUT_DATA = Object.freeze({
    SCHEMA_VERSION: 1,
    TYPE: 'hexa_hive',
    NORMALIZED_RADIUS: 0.47,
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
        Object.freeze({ x: 0, y: -0.47 }),
        Object.freeze({
            x: Math.cos(-Math.PI / 6) * 0.47,
            y: Math.sin(-Math.PI / 6) * 0.47
        }),
        Object.freeze({
            x: Math.cos(Math.PI / 6) * 0.47,
            y: Math.sin(Math.PI / 6) * 0.47
        }),
        Object.freeze({ x: 0, y: 0.47 }),
        Object.freeze({
            x: Math.cos((5 * Math.PI) / 6) * 0.47,
            y: Math.sin((5 * Math.PI) / 6) * 0.47
        }),
        Object.freeze({
            x: Math.cos((7 * Math.PI) / 6) * 0.47,
            y: Math.sin((7 * Math.PI) / 6) * 0.47
        })
    ])
});
