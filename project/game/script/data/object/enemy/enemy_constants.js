/**
 * 적 관련 상수 모음
 */
export const ENEMY_CONSTANTS = Object.freeze({
    POOL_WARMUP_COUNT: 300,
    DEFAULT_STYLE: Object.freeze({
        FILL: '#ff6c6c',
        ALPHA: 1,
        ROTATION: 0
    }),
    MOTION: Object.freeze({
        MAX_ANGULAR_VELOCITY: 720,
        AXIS_RESISTANCE_RECOVERY_SECONDS: 1,
        AXIS_RESISTANCE_RECOVER_DELAY_SECONDS: 0.08,
        AXIS_RESISTANCE_EPSILON: 1e-4,
        ANGULAR_DECAY_MIN_SECONDS: 0.016
    }),
    ANGLE: Object.freeze({
        FULL_TURN_DEG: 360,
        STRAIGHT_DEG: 180,
        DEGREES_TO_RADIANS: Math.PI / 180,
        RADIANS_TO_DEGREES: 180 / Math.PI
    }),
    SHAPE_HEADING: Object.freeze({
        TRACK_TYPES: Object.freeze(['triangle', 'arrow', 'rhom']),
        TURN_MAX_DEG_PER_SEC: 90,
        TURN_DAMP_START_DEG: 45,
        TURN_SNAP_EPSILON_DEG: 0.15,
        FORWARD_OFFSET_DEG: 90,
        MIN_SPEED_SQ: 36,
        SYMMETRY_STEP_BY_TYPE: Object.freeze({
            triangle: 120,
            rhom: 180
        })
    }),
    HEXA_HIVE: Object.freeze({
        RENDER: Object.freeze({
            CELL_SHAPE: 'hexagon',
            FRONT_SCALE: 1,
            BACKDROP_SCALE: 1.14,
            BACKDROP_FALLBACK_FILL: 'rgb(255, 212, 184)',
            BACKDROP_FILL_BLEND_RATIO: 0.72
        }),
        MERGE: Object.freeze({
            MAX_MEMBER_COUNT: 8,
            CONTACT_SECONDS: 0.5,
            PRESENTATION: Object.freeze({
                PULL_DISTANCE_RATIO: 0.18,
                MAX_PULL_HEIGHT_RATIO: 0.32,
                PULL_SAFE_CELL_DISTANCE_RATIO: 0.82,
                MIN_EFFECT_PROGRESS: 0.04,
                MAX_EFFECT_COMMANDS: 8,
                EFFECT_LINE_LENGTH_RATIO: 0.62,
                EFFECT_LINE_WIDTH_RATIO: 0.07,
                EFFECT_GLOW_WIDTH_RATIO: 0.16,
                SETTLE_SECONDS: 0.18
            }),
            MOVE_SPEED_DECAY: 0.95,
            MOVE_SPEED_FLOOR_RATIO: 0.5,
            WEIGHT_SCALE_PER_EXTRA_CELL: 0.5,
            PENDING_WEIGHT: 100000,
            HP_RECOVERY_RATIO: 0.1,
            EPSILON: 1e-6
        })
    }),
    COLLISION_DEBUG: Object.freeze({
        ENEMY_PAIR_STROKE: 'rgba(255, 96, 96, 0.95)',
        PROJECTILE_STROKE: 'rgba(64, 240, 255, 0.95)',
        ENEMY_PAIR_LINE_WIDTH: 1.65,
        PROJECTILE_LINE_WIDTH: 1.85,
        DEFAULT_LAYER: 'top'
    })
});
