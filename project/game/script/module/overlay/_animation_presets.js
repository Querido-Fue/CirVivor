export const DEFAULT_OVERLAY_ANIMATION_PRESET = 'uiAnimation';

/**
 * 오버레이 애니메이션 프리셋 테이블입니다.
 * 새 프리셋은 동일한 스키마(open/close/dim)로 추가하면 됩니다.
 */
export const OVERLAY_ANIMATION_PRESETS = Object.freeze({
    uiAnimation: Object.freeze({
        open: Object.freeze({
            alpha: Object.freeze({ from: 0, to: 1, duration: 0.3, easing: 'easeOutExpo' }),
            scale: Object.freeze({ from: 0.9, to: 1, duration: 0.4, easing: 'easeOutExpo' }),
            blur: Object.freeze({ from: 10, to: 0, duration: 0.3, easing: 'easeOutExpo' })
        }),
        close: Object.freeze({
            alpha: Object.freeze({ to: 0, duration: 0.3, easing: 'easeInExpo' }),
            scale: Object.freeze({ to: 0.9, duration: 0.3, easing: 'easeInExpo' }),
            blur: Object.freeze({ to: 10, duration: 0.3, easing: 'easeInExpo' })
        }),
        dim: Object.freeze({ openMode: 'instant', closeMode: 'afterAnimation' })
    }),
    softFocus: Object.freeze({
        open: Object.freeze({
            alpha: Object.freeze({ from: 0, to: 1, duration: 0.26, easing: 'easeOutCubic' }),
            scale: Object.freeze({ from: 0.96, to: 1, duration: 0.3, easing: 'easeOutCubic' }),
            blur: Object.freeze({ from: 6, to: 0, duration: 0.26, easing: 'easeOutCubic' })
        }),
        close: Object.freeze({
            alpha: Object.freeze({ to: 0, duration: 0.22, easing: 'easeInCubic' }),
            scale: Object.freeze({ to: 0.96, duration: 0.22, easing: 'easeInCubic' }),
            blur: Object.freeze({ to: 6, duration: 0.22, easing: 'easeInCubic' })
        }),
        dim: Object.freeze({ openMode: 'instant', closeMode: 'afterAnimation' })
    }),
    snapZoom: Object.freeze({
        open: Object.freeze({
            alpha: Object.freeze({ from: 0, to: 1, duration: 0.18, easing: 'easeOutExpo' }),
            scale: Object.freeze({ from: 0.92, to: 1, duration: 0.2, easing: 'easeOutExpo' }),
            blur: Object.freeze({ from: 4, to: 0, duration: 0.18, easing: 'easeOutExpo' })
        }),
        close: Object.freeze({
            alpha: Object.freeze({ to: 0, duration: 0.16, easing: 'easeInExpo' }),
            scale: Object.freeze({ to: 0.92, duration: 0.16, easing: 'easeInExpo' }),
            blur: Object.freeze({ to: 4, duration: 0.16, easing: 'easeInExpo' })
        }),
        dim: Object.freeze({ openMode: 'instant', closeMode: 'afterAnimation' })
    })
});

export const getOverlayAnimationPreset = (name) => {
    if (name && OVERLAY_ANIMATION_PRESETS[name]) {
        return OVERLAY_ANIMATION_PRESETS[name];
    }
    return OVERLAY_ANIMATION_PRESETS[DEFAULT_OVERLAY_ANIMATION_PRESET];
};
