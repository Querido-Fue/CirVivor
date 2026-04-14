/**
 * 게임 전반에 걸쳐 사용되는 전역 상수 모음
 */
export const GLOBAL_CONSTANTS = {
    ASPECT_RATIO: {
        WIDTH: 16,
        HEIGHT: 9,
        RATIO: 16 / 9
    },
    POOL_WARMUP: {
        ANIMATOR: 500,
        TEXT: 50,
        SLIDER: 10,
        BUTTON: 30,
        SEGMENT_CONTROL: 10,
        DROPDOWN: 10,
        LINE: 30,
        TOGGLE: 10,
        CANVAS_2D: 16,
        CANVAS_WEBGL: 8
    },
    GAME_VERSION: "0.41",
    WEBGL_MAX_SPRITES: 16000,
    SLIDER_MAX_OVERFLOW: 0.05,
    DEBUG_MODE_TOGGLE: Object.freeze({
        REQUIRED_MIDDLE_CLICKS: 5,
        CLICK_WINDOW_MS: 2000
    }),
    FALLBACK_LAYOUT: "ui"
};
