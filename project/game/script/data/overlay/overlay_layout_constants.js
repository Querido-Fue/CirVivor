/**
 * 오버레이 레이아웃 구성에 필요한 상수 모음
 */
export const OVERLAY_LAYOUT_CONSTANTS = Object.freeze({
    PRESENTATION: Object.freeze({
        OPEN_START_SCALE: 1.1,
        DURATION_SECONDS: 0.4,
        CLOSE_END_SCALE: 0.85
    }),
    EXIT: Object.freeze({
        WIDTH_UIWW_RATIO: 0.3,
        HEIGHT_WH_RATIO: 0.2
    }),
    EXTERNAL_LINK_WARNING: Object.freeze({
        DISPLAY_MAX_LENGTH: 55,
        HEIGHT_MULTIPLIER: 1.15,
        TRANSPARENT_COLOR: 'rgba(0, 0, 0, 0)'
    })
});
