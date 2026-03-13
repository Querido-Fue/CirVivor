/**
 * 타이틀 화면과 관련된 설정 상수 모음
 */
export const TITLE_CONSTANTS = Object.freeze({
    TITLE_ENEMIES: Object.freeze({
        ENEMY_SPAWN_RATE: 40,
        ENEMY_LIMIT: 400,
        ENEMY_EXCLUDED_TYPES: Object.freeze(['gen']),
        SHIELD_RADIUS_RATIO: 0.07,
        SHIELD_ANIM_DURATION: 1.2,
        SHIELD_ANIM_DELAY: 1,
        ENEMY_CULL_OUTSIDE_RATIO: 0.1,
        ENEMY_SPAWN_X_RATIO: 1.05,
        ENEMY_SIZE_MIN: 1,
        ENEMY_SIZE_MAX: 1.2,
        ENEMY_ALPHA_MIN: 0.2,
        ENEMY_ALPHA_MAX: 0.45,
        AXIS_SPEED_MIN_RATIO: 0.02,
        AXIS_SPEED_MAX_RATIO: 0.07,
        DRIFT_SPEED_MIN_RATIO: -0.02,
        DRIFT_SPEED_MAX_RATIO: 0.02,
        PARALLAX_LAYERS: Object.freeze([
            Object.freeze({
                Id: 'far',
                SizeMin: 0.42,
                SizeMax: 0.56,
                Alpha: 0.4,
                SpeedScale: 0.3,
                MagneticScale: 1,
                ColorMix: 0.72,
                SoftnessScale: 1.14,
                SoftnessAlpha: 0.16,
                SoftnessOffsetPx: 1.4
            }),
            Object.freeze({
                Id: 'mid',
                SizeMin: 0.64,
                SizeMax: 0.8,
                Alpha: 0.52,
                SpeedScale: 0.62,
                MagneticScale: 1,
                ColorMix: 0.38,
                SoftnessScale: 1.06,
                SoftnessAlpha: 0.08,
                SoftnessOffsetPx: 0.7
            }),
            Object.freeze({
                Id: 'near',
                SizeMin: 0.88,
                SizeMax: 1,
                Alpha: 0.7,
                SpeedScale: 1,
                MagneticScale: 1,
                ColorMix: 0.1,
                SoftnessScale: 1.02,
                SoftnessAlpha: 0.03,
                SoftnessOffsetPx: 0.2
            })
        ]),
        SPAWN_Y_MIN_RATIO: 0.03,
        SPAWN_Y_MAX_RATIO: 0.97
    }),
    TITLE_AI: Object.freeze({
        MAGNETIC_IMPULSE: 2000,
        MAGNETIC_DAMPING: 6,
        MOUSE_IDLE_STRENGTH: 2,
        MOUSE_CLICK_STRENGTH: 5,
        MOUSE_IDLE_DISTANCE_RATIO: 0.05,
        MOUSE_CLICK_DISTANCE_RATIO: 0.1,
        LOGO_STRENGTH: 4,
        LOGO_DISTANCE_RATIO: 0.56,
        LOGO_DISTANCE_MULTIPLIER: 2.25
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
    TITLE_LOADING: Object.freeze({
        DURATION: 6,
        SEGMENT_COUNT: 6,
        SEGMENT_MIN_DURATION: 0.21,
        STEP_ANIM_DURATION: 0.4,
        COMPLETE_PROGRESS: 1.1,
        TEXT_ALPHA: 0.7,
        TEXT_FADE_DURATION: 0.4,
        TEXT_EXIT_DISTANCE_RATIO: 0.009,
        CIRCLE_CENTER_X_RATIO: 0.35,
        CIRCLE_CENTER_Y_RATIO: 0.5,
        CIRCLE_RADIUS_WH_RATIO: 0.115,
        CIRCLE_RADIUS_UIWW_RATIO: 0.22,
        OUTLINE_WIDTH_WH_RATIO: 0.0024,
        TEXT_GAP_WH_RATIO: 0.076,
        TEXT_FONT_SIZE_WH_RATIO: 0.016,
        SCENE_TRANSITION_TRIGGER_PROGRESS: 0.9,
        SCENE_TRANSITION_DURATION: 1,
        MINI_CIRCLE_SCALE: 1,
        GLOW_COMPENSATION_SCALE: 4,
        LOGO_FINAL_LEFT_UIWW_RATIO: 0.11,
        LOGO_FINAL_CENTER_Y_RATIO: 0.5,
        LOGO_FINAL_WIDTH_UIWW_RATIO: 0.19
    }),
    TITLE_SHIELD: Object.freeze({
        IMPACT_MAX_COUNT: 8,
        DENT_MAX_COUNT: 6,
        BASE_ALPHA: 1,
        SHELL_RADIUS_MULTIPLIER: 1.4,
        RING_THICKNESS_PX: 1.75,
        GLOW_WIDTH_PX: 26,
        FIELD_RADIUS_MULTIPLIER: 3,
        IMPACT_DURATION_SECONDS: 3,
        IMPACT_BAND_PX: 18,
        CONTACT_PADDING_PX: 10,
        PRESSURE_INFLUENCE_PX: 54,
        VISUAL_TRIGGER_DISTANCE_MULTIPLIER: 1.2,
        PRESSURE_FOLLOW_RATE: 12,
        PRESSURE_MAX_DEPTH_PX: 18,
        ANGULAR_WIDTH_PADDING_PX: 12,
        ANGULAR_WIDTH_SCALE: 1.15,
        IMPACT_INTENSITY_MIN: 0.2,
        IMPACT_INTENSITY_MAX: 0.52,
        IMPACT_SPEED_REFERENCE_PX: 120
    }),
    TITLE_TRANSITION: Object.freeze({
        ENEMY_FADE_DURATION: 0.8,
        LOGO_EXIT_DURATION: 1.1,
        MENU_EXIT_DURATION: 0.8,
        MENU_LINE_EXIT_DELAY: 0.1,
        SELECTOR_EXIT_DELAY: 0.2
    }),
    TITLE_CARD_MENU: Object.freeze({
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
        UTILITY_TILE_TARGET_SIZE_PX: 68,
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
    }),
    TITLE_OVERLAY: Object.freeze({
        SETTINGS: Object.freeze({
            WIDTH_UIWW_RATIO: 0.65,
            HEIGHT_WH_RATIO: 0.7
        }),
        DECK: Object.freeze({
            WIDTH_UIWW_RATIO: 0.65,
            HEIGHT_WH_RATIO: 0.7
        }),
        CREDITS: Object.freeze({
            WIDTH_UIWW_RATIO: 0.4,
            HEIGHT_WH_RATIO: 0.55
        }),
        QUICK_START: Object.freeze({
            WIDTH_UIWW_RATIO: 0.42,
            HEIGHT_WH_RATIO: 0.34
        }),
        RECORDS: Object.freeze({
            WIDTH_UIWW_RATIO: 0.5,
            HEIGHT_WH_RATIO: 0.42
        }),
        RESEARCH: Object.freeze({
            WIDTH_UIWW_RATIO: 0.54,
            HEIGHT_WH_RATIO: 0.5
        }),
        ACHIEVEMENTS: Object.freeze({
            WIDTH_UIWW_RATIO: 0.54,
            HEIGHT_WH_RATIO: 0.5
        })
    })
});
