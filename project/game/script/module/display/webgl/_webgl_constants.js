/**
 * WebGL effect 레이어 렌더 명령과 pass registry가 공유하는 타입입니다.
 */
export const EFFECT_TYPES = Object.freeze({
    MAGNETIC_SHIELD: 'magneticShield',
    HEXA_MERGE_BOUNDARY: 'hexaMergeBoundary',
    TITLE_LOADING_CIRCLE: 'titleLoadingCircle'
});

/**
 * WebGL batch와 texture cache가 공유하는 렌더링 상수입니다.
 */
export const WEBGL_CONSTANTS = Object.freeze({
    SHAPE_TEXTURE_SIZE: 96,
    BATCH_VERTEX_SIZE: 8,
    COLOR_CACHE_LIMIT: 256,
    DEFAULT_BACKGROUND_COLOR: Object.freeze([0.125, 0.125, 0.125, 1.0])
});

/**
 * 단일 WebGL batch가 보관할 최대 sprite 수입니다.
 */
export const WEBGL_MAX_SPRITES = 16000;

/**
 * 오버레이 렌더링과 Kawase blur 합성이 공유하는 구현 상수입니다.
 */
export const OVERLAY_RENDER_CONSTANTS = Object.freeze({
    BACKDROP_SAMPLING_ENABLED: true,
    BLUR_UPDATE_MODE: Object.freeze({
        DIRTY: 'dirty',
        ALWAYS: 'always'
    }),
    KAWASE_COMPATIBILITY_QUALITY_PRESET: 'compatibility',
    KAWASE_DEFAULT_DOWN_PASSES: 4,
    KAWASE_DEFAULT_UP_PASSES: 4,
    KAWASE_MIN_SIZE: 8,
    GLASS_TINT_COLOR: Object.freeze([1.0, 1.0, 1.0, 1.0]),
    GLASS_TINT_STRENGTH: 0.18,
    GLASS_EDGE_COLOR: Object.freeze([1.0, 1.0, 1.0, 1.0]),
    GLASS_EDGE_STRENGTH: 0.55,
    GLASS_REFRACTION_STRENGTH: 0.0,
    GLASS_SHADOW_ALPHA: 0.18,
    GLASS_TRANSITION_DURATION_SECONDS: 0.4,
    GLASS_TRANSITION_EASING: 'easeOutExpo',
    FLOATING_DROPDOWN_BLUR_RADIUS: 0.1
});
