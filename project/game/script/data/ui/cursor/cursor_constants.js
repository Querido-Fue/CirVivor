/**
 * 마우스 커서 렌더링 및 애니메이션 관련 상수 모음
 */
export const CURSOR_CONSTANTS = Object.freeze({
    NORMAL: Object.freeze({
        ARROW_ROTATION_DEG: 330,
        LARGE_ARROW_SIZE_WH_RATIO: 0.015,
        SMALL_ARROW_SIZE_WH_RATIO: 0.014,
        SUB_CIRCLE_RADIUS_WH_RATIO: 0.015,
        SUB_CIRCLE_ALPHA: 0.5,
        SUB_CIRCLE_OFFSET_X_WH_RATIO: 0.01,
        SUB_CIRCLE_OFFSET_Y_WH_RATIO: 0.02,
        CLICK_RADIUS_MULTIPLIER: 0.7,
        CLICK_ALPHA_MULTIPLIER: 1.5,
        ANIM_DURATION: 0.5
    }),
    ATTACK: Object.freeze({
        LINE_LONG_PX: 8,
        LINE_SHORT_PX: 3,
        CENTER_DOT_RADIUS_PX: 2,
        SHADOW_BLUR_PX: 10,
        LINE_WIDTH_PX: 1,
        ANIM_DURATION: 0.3
    })
});
