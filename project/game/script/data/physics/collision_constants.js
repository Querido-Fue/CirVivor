/**
 * 충돌 시스템의 정적 튜닝 상수입니다.
 */
export const COLLISION_CONSTANTS = Object.freeze({
    EPSILON: 1e-6,
    RULES: Object.freeze({
        NONE: Object.freeze({
            check: false,
            resolve: false,
            movableA: null,
            movableB: null,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        DYNAMIC_RESOLVE: Object.freeze({
            check: true,
            resolve: true,
            movableA: null,
            movableB: null,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        ENEMY_PLAYER: Object.freeze({
            check: true,
            resolve: true,
            movableA: true,
            movableB: false,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        PLAYER_ENEMY: Object.freeze({
            check: true,
            resolve: true,
            movableA: false,
            movableB: true,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        PROJECTILE_ENEMY: Object.freeze({
            check: true,
            resolve: false,
            movableA: null,
            movableB: null,
            oneShotByProjectile: true,
            applyImpactRotation: true
        }),
        PLAYER_PROJECTILE: Object.freeze({
            check: true,
            resolve: false,
            movableA: null,
            movableB: null,
            oneShotByProjectile: true,
            applyImpactRotation: false
        }),
        PLAYER_ITEM: Object.freeze({
            check: true,
            resolve: false,
            movableA: null,
            movableB: null,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        PROJECTILE_PROJECTILE: Object.freeze({
            check: true,
            resolve: false,
            movableA: null,
            movableB: null,
            oneShotByProjectile: true,
            applyImpactRotation: false
        }),
        WALL_PROJECTILE: Object.freeze({
            check: true,
            resolve: false,
            movableA: false,
            movableB: true,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        PROJECTILE_WALL: Object.freeze({
            check: true,
            resolve: false,
            movableA: true,
            movableB: false,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        WALL_OTHER: Object.freeze({
            check: true,
            resolve: true,
            movableA: false,
            movableB: true,
            oneShotByProjectile: false,
            applyImpactRotation: false
        }),
        OTHER_WALL: Object.freeze({
            check: true,
            resolve: true,
            movableA: true,
            movableB: false,
            oneShotByProjectile: false,
            applyImpactRotation: false
        })
    }),
    FRAME_STATS: Object.freeze({
        BASE_FIELDS: Object.freeze([
            'collisionCheckCount',
            'aabbPassCount',
            'aabbRejectCount',
            'circlePassCount',
            'circleRejectCount',
            'partChecks'
        ]),
        PROFILE_FIELDS: Object.freeze([
            'enemyTotalMs',
            'enemyBodyBuildMs',
            'playerBodyBuildMs',
            'wallBodyBuildMs',
            'enemyPositionSolveMs',
            'enemyStabilizeMs',
            'enemyNonPositionMs',
            'solveGridMs',
            'solvePairScanMs',
            'solveCandidateBuildMs',
            'solvePairProcessMs',
            'solveNarrowphaseMs',
            'projectileTotalMs',
            'projectileEnemyBodyBuildMs',
            'projectileGridBuildMs',
            'projectileScanMs',
            'projectileCandidateQueryMs',
            'projectileNarrowphaseMs',
            'contactTotalMs',
            'contactBodyBuildMs',
            'contactGridBuildMs',
            'contactPairScanMs',
            'solveBucketPairCount',
            'solveCandidatePairCount',
            'solveDuplicatePairSkipCount',
            'solveRuleRejectCount',
            'solveAabbPassCount',
            'solveCirclePassCount',
            'solveResolvedPairCount',
            'solveSoACirclePairCount',
            'solveObjectNarrowphasePairCount',
            'solveBudgetSkipCount',
            'solveLargePopulationMode'
        ])
    }),
    GRID: Object.freeze({
        CELL_KEY_OFFSET: 4096,
        CELL_KEY_STRIDE: 8192,
        MIN_CELL_SIZE: 20,
        MAX_CELL_SIZE: 280,
        CELL_SIZE_RADIUS_SCALE: 2.4,
        DEFAULT_RADIUS_WORLD_RATIO: 0.015,
        DEFAULT_RADIUS_MIN: 12,
        RADIUS_SCALE: 1.03,
        QUERY_INITIAL_CAPACITY: 512,
        BROADPHASE_INITIAL_CAPACITY: 512,
        BUCKET_INITIAL_CAPACITY: 8
    }),
    SOLVER: Object.freeze({
        DEFAULT_PHYSICS_ITERATION_COUNT: 3,
        PROJECTILE_SWEEP_RADIUS_STEP: 0.45
    }),
    SLEEP: Object.freeze({
        IDLE_TICKS_TO_SLEEP: 45,
        TICKS: 2,
        SPEED_SQ: 9
    }),
    ENEMY_PAIR_PROCESS_BUDGET: Object.freeze({
        POSITION: 14,
        STABILIZE: 10,
        NON_POSITION: 8
    }),
    RESOLVE_TUNING: Object.freeze({
        FRAME_MAX_RATIO: 0.42,
        FRAME_MIN_MAX: 2.2,
        MIN_MAX: 1.25,
        HEXA_HIVE_RADIUS_SCALE: 1.1,
        HEXA_HIVE_RADIUS_ROOT_SCALE: 0.55,
        ENEMY_PAIR_RADIUS_BASE_SCALE: 0.9,
        ENEMY_PROJECTILE_RADIUS_BASE_SCALE: 1.1,
        HEXA_HIVE_CELL_RADIUS_BASE: 0.47,
        DEFAULT_BODY_RADIUS: 16,
        PERCENT: 0.55,
        SLOP: 0.8,
        MAX_RATIO: 0.16,
        RADIUS_TUNING_SCALE: 0.85,
        DENSE_REBUILD_DENSITY_THRESHOLD: 0.45,
        DENSE_REBUILD_MIN_RESOLVED: 8,
        DENSE_REBUILD_MAX_EXTRA_PASSES: 4,
        DENSE_MIN_ITERATION_FLOOR: 5,
        DENSE_LOCAL_CANDIDATE_THRESHOLD: 8,
        DENSE_STABILIZE_MAX_PASSES: 4,
        DENSE_STABILIZE_LIGHT_MAX_PASSES: 2,
        DENSE_STABILIZE_MIN_RESOLVED: 4,
        DENSE_ADAPTIVE_LIGHT_DENSITY_THRESHOLD: 0.5,
        DENSE_ADAPTIVE_DENSITY_SCALE: 2,
        DENSE_ADAPTIVE_MIN_ITERATIONS: 2,
        DENSE_STABILIZE_HEAVY_CANDIDATE_SCALE: 2,
        DENSE_ITERATION_RESOLVE_BOOST: 1.18,
        DENSE_RESOLVE_BOOST: 1.55,
        LARGE_POPULATION_DENSE_BODY_THRESHOLD: 512,
        LARGE_POPULATION_DENSE_REBUILD_MAX_EXTRA_PASSES: 2,
        LARGE_POPULATION_DENSE_MIN_ITERATION_FLOOR: 3,
        LARGE_POPULATION_DENSE_STABILIZE_MAX_PASSES: 2,
        LARGE_POPULATION_DENSE_STABILIZE_LIGHT_MAX_PASSES: 1,
        LARGE_POPULATION_DENSE_ITERATION_RESOLVE_BOOST: 1.28,
        LARGE_POPULATION_DENSE_RESOLVE_BOOST: 1.85,
        DENSE_CORRECTION_CANDIDATE_THRESHOLD: 5,
        DENSE_CORRECTION_SCALE_PER_NEIGHBOR: 0.06,
        DENSE_CORRECTION_SCALE_MAX: 2.4,
        DENSE_FRAME_CANDIDATE_THRESHOLD: 6,
        DENSE_FRAME_SCALE_PER_NEIGHBOR: 0.065,
        DENSE_FRAME_SCALE_MAX: 2.5,
        PRESSURE_WEIGHT_MIN: 0.35,
        PRESSURE_WEIGHT_MAX: 8,
        PRESSURE_HEXA_HIVE_WEIGHT_MAX: 64,
        PRESSURE_WEIGHT_EXPONENT: 0.6,
        MERGE_PENDING_RESOLVE_WEIGHT: 100000,
        PRESSURE_ENTRY_THRESHOLD: 4,
        PRESSURE_ENTRY_SCALE_PER_NEIGHBOR: 0.14,
        PRESSURE_ENTRY_SCALE_MAX: 2.8,
        PRESSURE_ESCAPE_THRESHOLD: 8,
        PRESSURE_ESCAPE_SCALE_PER_NEIGHBOR: 0.055,
        PRESSURE_ESCAPE_SCALE_MAX: 1.45,
        HEXA_HIVE_WALL_MIN_PARTS: 2
    }),
    BODY_TRANSLATION: Object.freeze({
        AXIS_RESISTANCE_MIN: 0.25,
        AXIS_RESISTANCE_GAIN: 0.85,
        AXIS_RESISTANCE_RADIUS_RATIO: 0.35,
        AXIS_RESISTANCE_RADIUS_MIN: 1
    }),
    MANIFOLD: Object.freeze({
        MULTI_CONTACT_NORMAL_DIVERSITY_SCALE: 0.9,
        MULTI_CONTACT_PENETRATION_MULTIPLIER_MAX: 1.85,
        MULTI_CONTACT_DIVERSITY_SAMPLE_CAP: 3
    }),
    PROJECTILE_IMPACT: Object.freeze({
        ROTATION_IMPULSE_SCALE: 0.12,
        ROTATION_RESPONSE_MULTIPLIER: 1.3,
        PROJECTILE_WEIGHT_MIN: 0.01,
        ENEMY_WEIGHT_MIN: 0.1
    }),
    CANDIDATE_PAIR_BUFFER: Object.freeze({
        INITIAL_PAIR_CAPACITY: 1024,
        INITIAL_BITMAP_WORD_CAPACITY: 512,
        BIT_WORD_SIZE: 32,
        BIT_WORD_SHIFT: 5,
        BIT_WORD_MASK: 31
    }),
    BODY_BUILDER: Object.freeze({
        CIRCLE_PART_STRIDE: 3,
        BOUND_RADIUS_HALF_SCALE: 0.5,
        DEGREES_TO_RADIANS: Math.PI / 180
    }),
    SOA_LAYOUT: Object.freeze({
        BROAD_STRIDE: 14,
        RELATION_BROAD_STRIDE: 8,
        CONTACT_RESULT_STRIDE: 8,
        BODY_KIND: Object.freeze({
            NONE: 0,
            ENEMY: 1,
            PLAYER: 2,
            WALL: 3,
            PROJECTILE: 4,
            ITEM: 5
        }),
        BODY_SHAPE: Object.freeze({
            NONE: 0,
            CIRCLE: 1,
            CIRCLE_PARTS: 2,
            RECT: 3
        }),
        RELATION_INDEX: Object.freeze({
            MIN_X: 0,
            MAX_X: 1,
            MIN_Y: 2,
            MAX_Y: 3,
            CENTER_X: 4,
            CENTER_Y: 5,
            ENEMY_PAIR_RADIUS: 6,
            PROJECTILE_RADIUS: 7
        }),
        CONTACT_RESULT_INDEX: Object.freeze({
            PAIR_INDEX: 0,
            BODY_A_INDEX: 1,
            BODY_B_INDEX: 2,
            NORMAL_X: 3,
            NORMAL_Y: 4,
            PENETRATION: 5,
            POINT_X: 6,
            POINT_Y: 7
        })
    })
});
