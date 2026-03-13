/**
 * 화면 비네팅 렌더링에 사용하는 상수입니다.
 */
export const VIGNETTE_CONSTANTS = Object.freeze({
    BASE_REFERENCE_HEIGHT_PX: 1080,
    BASE_EDGE_WIDTH_PX: 200,
    BASE_EDGE_ALPHA: 0.68,
    BASE_CORNER_RADIUS_PX: 260,
    DITHER_STRENGTH: 1.1,
    MASK_INSET_MULTIPLIER: 0.24,
    BLUR_RADIUS_MULTIPLIER: 0.82,
    MIN_EDGE_WIDTH_RATIO: 0.08,
    MAX_EDGE_WIDTH_RATIO: 0.42,
    LAYERS: Object.freeze({
        WORLD: Object.freeze({
            ID: 'vignette',
            ORDER: 50,
            EDGE_WIDTH_MULTIPLIER: 0.7716
        })
    })
});
