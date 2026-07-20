/**
 * 오버레이 렌더링과 Kawase blur 합성에 사용하는 상수입니다.
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
