/**
 * 타이틀 전용 적 AI의 응답·자기장 런타임 상수입니다.
 */
export const TITLE_AI_CONSTANTS = Object.freeze({
    ID: 'titleAI',
    ACCEL_RESPONSE: 6,
    PARALLAX_DEFAULT_SCALE: 1,
    SPAWN_BOOST_SETTLE_EPSILON: 0.001,
    BURST_VELOCITY_SETTLE_EPSILON: 0.01,
    MAGNETIC_IMPULSE: 1400,
    MAGNETIC_DAMPING: 6,
    MAX_SPEED_CAP_MULTIPLIER: 1.7,
    BURST_MAX_SPEED_CAP_MULTIPLIER: 15,
    MAX_SPEED_CAP_EASEOUT_EXPO_RATE: 12,
    BURST_VELOCITY_EASEOUT_EXPO_RATE: 11.5,
    BURST_ACCEL_RESPONSE_MULTIPLIER: 3.5,
    MOUSE_IDLE_STRENGTH: 2,
    MOUSE_CLICK_STRENGTH: 5,
    MOUSE_IDLE_DISTANCE_RATIO: 0.05,
    MOUSE_CLICK_DISTANCE_RATIO: 0.1,
    LOGO_STRENGTH: 4,
    LOGO_DISTANCE_RATIO: 0.56,
    LOGO_DISTANCE_MULTIPLIER: 2.25
});

/** 타이틀 이미지와 SVG 로고가 공유하는 기본 배치 상수입니다. */
export const TITLE_IMAGE_LAYOUT = Object.freeze({
    WIDTH_RATIO: 0.3,
    ENTER_X_RATIO: 0.1
});

/**
 * 로딩에서 타이틀로 이어지는 원·로고 전환 런타임 상수입니다.
 */
export const TITLE_LOADING_CONSTANTS = Object.freeze({
    INTRO_START_DELAY_SECONDS: 1.5,
    INTRO_BLUR_START_PX: 10,
    INTRO_BLUR_DURATION: 0.6,
    INTRO_BLUR_EASING: 'easeOutExpo',
    CIRCLE_CENTER_X_RATIO: 0.35,
    CIRCLE_CENTER_Y_RATIO: 0.5,
    CIRCLE_RADIUS_WH_RATIO: 0.115,
    CIRCLE_RADIUS_UIWW_RATIO: 0.22,
    OUTLINE_WIDTH_WH_RATIO: 0.00085,
    SCENE_TRANSITION_TRIGGER_PROGRESS: 1,
    SCENE_TRANSITION_MOTION: Object.freeze({
        ACCEL: Object.freeze({
            DURATION: 0.3,
            EASING: 'easeInExpo'
        }),
        CRUISE: Object.freeze({
            DURATION: 0.2,
            EASING: 'linear'
        }),
        DECEL: Object.freeze({
            DURATION: 1.5,
            EASING: 'easeOutExpo'
        })
    }),
    MINI_CIRCLE_SCALE: 1,
    GLOW_COMPENSATION_SCALE: 4,
    GLOW_DEFAULTS: Object.freeze({
        HALO_STOPS: Object.freeze([
            Object.freeze({ offset: 0, color: null, alphaScale: 0, maxAlpha: 0 }),
            Object.freeze({ offset: 0.06, color: null, alphaScale: 0.022, maxAlpha: 0.038 }),
            Object.freeze({ offset: 0.14, color: null, alphaScale: 0.03, maxAlpha: 0.05 }),
            Object.freeze({ offset: 0.3, color: null, alphaScale: 0.032, maxAlpha: 0.054 }),
            Object.freeze({ offset: 0.5, color: null, alphaScale: 0.024, maxAlpha: 0.04 }),
            Object.freeze({ offset: 0.72, color: null, alphaScale: 0.013, maxAlpha: 0.022 }),
            Object.freeze({ offset: 0.9, color: null, alphaScale: 0.004, maxAlpha: 0.008 }),
            Object.freeze({ offset: 1, color: null, alphaScale: 0, maxAlpha: 0 })
        ]),
        RING: Object.freeze({
            Color: null,
            ShadowColor: null,
            AlphaScale: 0.052,
            AlphaMax: 0.09,
            ShadowAlphaScale: 0.07,
            ShadowAlphaMax: 0.12
        }),
        SURFACE: Object.freeze({
            Highlight: null,
            HighlightAlpha: 0.95,
            Shadow: null,
            ShadowAlpha: 0.45
        })
    }),
    CIRCLE_SHADER: Object.freeze({
        COLORS: Object.freeze({
            base: Object.freeze([0.086, 0.435, 0.984]),
            deep: Object.freeze([0.016, 0.176, 0.62]),
            rim: Object.freeze([0.4, 0.737, 1]),
            highlight: Object.freeze([0.94, 0.99, 1])
        }),
        ALPHA: 0.92,
        GLOW_STRENGTH: 0.12,
        GLASS_STRENGTH: 0.62,
        BRIGHTNESS_BOOST: 0.08,
        GLOW_COMPENSATION_STRENGTH_SCALE: 0.08,
        BODY_RADIUS_EXPAND_OUTLINE_RATIO: 0.58,
        BACKDROP_BLUR: 6.5,
        BACKDROP_BLUR_STRENGTH: 0.36,
        BACKDROP_REFRACTION_STRENGTH: 5.2,
        SCISSOR_PADDING_RADIUS_RATIO: 0.86,
        SCISSOR_PADDING_MIN_PX: 28
    }),
    LOGO_FINAL_LEFT_UIWW_RATIO: 0.11,
    LOGO_FINAL_CENTER_Y_RATIO: 0.5,
    LOGO_FINAL_WIDTH_UIWW_RATIO: 0.19
});

/**
 * 활성 타이틀 카드 메뉴의 배치·등장 런타임 상수입니다.
 */
export const TITLE_CARD_MENU_CONSTANTS = Object.freeze({
    LOGO_LEFT_MARGIN_UIWW_RATIO: 0.065,
    LOGO_TOP_MARGIN_WH_RATIO: 0.11,
    GRID_RIGHT_MARGIN_UIWW_RATIO: 0.065,
    GRID_BOTTOM_MARGIN_WH_RATIO: 0.11,
    GRID_GAP_UIWW_RATIO: 0.012,
    COLUMN_WIDTH_UIWW_RATIO: 0.15,
    LARGE_CARD_HEIGHT_TO_WIDTH_RATIO: 1,
    QUICK_START_TO_RECORD_RATIO: 2.8,
    CARD_RADIUS_WH_RATIO: 0.018,
    APPEAR_START_DELAY_SECONDS: 0.3,
    APPEAR_DURATION_SECONDS: 1.29,
    ENTRANCE_START_SCALE: 1.12,
    ENTRANCE_OFFSET_X_UIWW_RATIO: 0.075,
    ENTRANCE_OFFSET_Y_WH_RATIO: 0.035,
    UTILITY_PANE_TOP_WH_RATIO: 0.72,
    UTILITY_TILE_GAP_UIWW_RATIO: 0.008,
    UTILITY_TILE_TARGET_SIZE_UIWW_RATIO: 68 / 2560,
    UTILITY_TILE_SCALE: 1.25,
    UTILITY_TILE_CORNER_RADIUS_RATIO: 0.18,
    UTILITY_TILE_PLACEHOLDER_SCALE: 0.34,
    UTILITY_TILE_PLACEHOLDER_RADIUS_RATIO: 0.2,
    REVEAL_CONFIGS: Object.freeze({
        start: Object.freeze({
            delaySeconds: 0,
            durationSeconds: 0.58,
            offsetXRatio: 0.01,
            offsetYRatio: 0.015,
            scaleOffset: 0.06
        }),
        quick_start: Object.freeze({
            delaySeconds: 0.05,
            durationSeconds: 0.66,
            offsetXRatio: 0.03,
            offsetYRatio: -0.01,
            scaleOffset: 0.04
        }),
        records: Object.freeze({
            delaySeconds: 0.11,
            durationSeconds: 0.74,
            offsetXRatio: 0.04,
            offsetYRatio: 0.01,
            scaleOffset: 0.02
        }),
        deck: Object.freeze({
            delaySeconds: 0.14,
            durationSeconds: 0.82,
            offsetXRatio: 0.02,
            offsetYRatio: 0.03,
            scaleOffset: 0.045
        }),
        research: Object.freeze({
            delaySeconds: 0.19,
            durationSeconds: 0.9,
            offsetXRatio: 0.035,
            offsetYRatio: 0.04,
            scaleOffset: 0.03
        })
    })
});
