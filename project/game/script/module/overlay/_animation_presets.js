/**
 * 기본 오버레이 애니메이션 프리셋 이름입니다.
 */
export const DEFAULT_OVERLAY_ANIMATION_PRESET = 'uiAnimation';

/**
 * 오버레이 애니메이션 프리셋 테이블입니다.
 */
export const OVERLAY_ANIMATION_PRESETS = Object.freeze({
    uiAnimation: Object.freeze({
        open: Object.freeze({
            alpha: Object.freeze({ from: 0, to: 1, duration: 0.5, easing: 'easeOutExpo' }),
            scale: Object.freeze({ from: 0.9, to: 1, duration: 0.5, easing: 'easeOutExpo' }),
            blur: Object.freeze({ from: 10, to: 0, duration: 0.5, easing: 'easeOutExpo' })
        }),
        close: Object.freeze({
            alpha: Object.freeze({ to: 0, duration: 0.5, easing: 'easeInExpo' }),
            scale: Object.freeze({ to: 0.9, duration: 0.5, easing: 'easeInExpo' }),
            blur: Object.freeze({ to: 10, duration: 0.5, easing: 'easeInExpo' })
        })
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
        })
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
        })
    })
});

/**
 * truthy인 이름으로 프리셋 프로퍼티를 직접 조회하며, 조회값이 falsy이면 기본 프리셋을 반환합니다.
 * own-key/type 검증이 없고 성공한 키를 다시 조회하므로 상속 키·키 변환·예외·두 조회 사이 결과를 그대로 보존합니다.
 * @param {*} name - 직접 조회할 프로퍼티 키 후보입니다.
 * @returns {*} 두 번째 직접 조회값 또는 기본 프리셋입니다.
 */
export const getOverlayAnimationPreset = (name) => {
    if (name && OVERLAY_ANIMATION_PRESETS[name]) {
        return OVERLAY_ANIMATION_PRESETS[name];
    }
    return OVERLAY_ANIMATION_PRESETS[DEFAULT_OVERLAY_ANIMATION_PRESET];
};
