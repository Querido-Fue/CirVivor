/**
 * 타이틀 화면과 관련된 설정 상수 모음
 */
export const TITLE_CONSTANTS = Object.freeze({
    TITLE_ENEMIES: Object.freeze({
        ENEMY_START_COUNT: 600,
        ENEMY_SPAWN_RATE: 40,
        ENEMY_LIMIT: 700,
        ENEMY_EXCLUDED_TYPES: Object.freeze(['gen']),
        SHIELD_RADIUS_RATIO: 0.07,
        SHIELD_ANIM_DURATION: 1.2,
        SHIELD_ANIM_DELAY: 1,
        ENEMY_CULL_OUTSIDE_RATIO: 0.1,
        ENEMY_SPAWN_X_RATIO: 1.1,
        ENEMY_SIZE_MIN: 1,
        ENEMY_SIZE_MAX: 1.2,
        ENEMY_ALPHA_MIN: 0.2,
        ENEMY_ALPHA_MAX: 0.45,
        AXIS_SPEED_MIN_RATIO: 0.02,
        AXIS_SPEED_MAX_RATIO: 0.07,
        DRIFT_SPEED_MIN_RATIO: -0.02,
        DRIFT_SPEED_MAX_RATIO: 0.02,
        SPAWN_Y_MIN_RATIO: 0.03,
        SPAWN_Y_MAX_RATIO: 0.97,
        INTRO: Object.freeze({
            MIN_DURATION: 1.1,
            MAX_DURATION: 2.2,
            MAX_DELAY: 0.35,
            TARGET_X_MIN_RATIO: 0.03,
            TARGET_X_MAX_RATIO: 0.97
        })
    }),
    TITLE_AI: Object.freeze({
        MAGNETIC_IMPULSE: 2000,
        MAGNETIC_DAMPING: 6,
        MOUSE_IDLE_STRENGTH: 2,
        MOUSE_CLICK_STRENGTH: 5,
        MOUSE_IDLE_DISTANCE_RATIO: 0.05,
        MOUSE_CLICK_DISTANCE_RATIO: 0.1,
        LOGO_STRENGTH: 2,
        LOGO_DISTANCE_RATIO: 0.2
    }),
    TITLE_MENU: Object.freeze({
        BUTTON_HEIGHT: 0.035,
        MENU_ANCHOR_FROM_RIGHT_RATIO: 0.21,
        SELECTOR_ANCHOR_FROM_RIGHT_RATIO: 0.23,
        MENU_ENTER_START_OFFSET_RATIO: 0.2,
        LINE_ENTER_OFFSET_RATIO: 0.06,
        SELECTOR_OFFSET_RATIO: 0.07,
        SELECTOR_SIZE_RATIO: 0.015,
        SELECTOR_ROTATION: 90,
        BUTTON_WIDTH_RATIO: 0.23,
        BUTTON_MARGIN_RATIO: 0.01,
        BUTTON_FONT_SIZE_RATIO: 0.02,
        BUTTON_STACK_OFFSET: 2,
        LINE_STACK_OFFSET: 2.5,
        BUTTON_ANIM_BASE_DURATION: 0.8,
        BUTTON_ANIM_STEP_DURATION: 0.1,
        BUTTON_ANIM_DELAY: 0.5,
        LINE_WIDTH: 1.5,
        LINE_ANIMATION_START_WIDTH: 10,
        LINE_ANIM_DURATION: 0.6,
        LINE_ANIM_DELAY: 0.4,
        LINE_WIDTH_ANIM_DELAY: 0.3,
        LINE_ALPHA_ANIM_DELAY: 0.3,
        SELECTOR_MOVE_DURATION: 0.3,
        SELECTOR_ENTER_DURATION: 1,
        SELECTOR_ENTER_DELAY: 0.5,
        SELECTOR_ALPHA_ENTER_DURATION: 0.6,
        SHADOW_BLUR: 20
    }),
    TITLE_IMAGE: Object.freeze({
        SRC: 'image/title.png',
        WIDTH_RATIO: 0.3,
        ENTER_X_RATIO: 0.1,
        ENTER_DURATION: 0.6,
        ENTER_ALPHA_DURATION: 0.6,
        EXIT_LEFT_WIDTH_RATIO: 0.4
    }),
    TITLE_TRANSITION: Object.freeze({
        ENEMY_FADE_DURATION: 0.8,
        LOGO_EXIT_DURATION: 1.1,
        MENU_EXIT_DURATION: 0.8,
        MENU_LINE_EXIT_DELAY: 0.1,
        SELECTOR_EXIT_DELAY: 0.2
    }),
    TITLE_OVERLAY: Object.freeze({
        SETTINGS: Object.freeze({
            WIDTH_UIWW_RATIO: 0.65,
            HEIGHT_WH_RATIO: 0.7
        }),
        COLLECTION: Object.freeze({
            WIDTH_UIWW_RATIO: 0.65,
            HEIGHT_WH_RATIO: 0.7
        }),
        CREDITS: Object.freeze({
            WIDTH_UIWW_RATIO: 0.4,
            HEIGHT_WH_RATIO: 0.55
        })
    })
});
