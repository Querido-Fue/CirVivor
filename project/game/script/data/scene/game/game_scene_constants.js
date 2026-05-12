/**
 * 게임 씬 로컬 벤치마크와 HUD 렌더링에 사용하는 정적 상수입니다.
 */
export const GAME_SCENE_CONSTANTS = Object.freeze({
    PLAY_MAP: Object.freeze({
        PLAYER_ID: 1,
        PLAYER_RADIUS_RATIO: 0.023,
        PLAYER_WEIGHT: 999999,
        WALL_MIN_THICKNESS: 12,
        BOX_SIZE_RATIO: 0.06,
        PLAYER_POSITION: Object.freeze({
            X_RATIO: 0.5,
            Y_RATIO: 0.5
        }),
        STATIC_WALLS: Object.freeze([
            Object.freeze({ X_RATIO: 0.28, Y_RATIO: 0.5, WIDTH_WW_RATIO: 0.014, HEIGHT_WH_RATIO: 0.46 }),
            Object.freeze({ X_RATIO: 0.72, Y_RATIO: 0.5, WIDTH_WW_RATIO: 0.014, HEIGHT_WH_RATIO: 0.46 }),
            Object.freeze({ X_RATIO: 0.5, Y_RATIO: 0.32, WIDTH_WW_RATIO: 0.26, HEIGHT_WH_RATIO: 0.024 }),
            Object.freeze({ X_RATIO: 0.5, Y_RATIO: 0.68, WIDTH_WW_RATIO: 0.26, HEIGHT_WH_RATIO: 0.024 })
        ]),
        BOX_POSITIONS: Object.freeze([
            Object.freeze({ X_RATIO: 0.38, Y_RATIO: 0.42 }),
            Object.freeze({ X_RATIO: 0.62, Y_RATIO: 0.42 }),
            Object.freeze({ X_RATIO: 0.38, Y_RATIO: 0.58 }),
            Object.freeze({ X_RATIO: 0.62, Y_RATIO: 0.58 })
        ])
    }),
    BENCHMARK: Object.freeze({
        WALL_HEIGHT_RATIO: 0.5,
        WALL_THICKNESS_RATIO: 0.008,
        WALL_MIN_THICKNESS: 8,
        STATIC_WALL_X_RATIOS: Object.freeze([0.25, 0.75]),
        WORLD_CENTER_RATIO: 0.5,
        BOX_SIZE_RATIO: 0.05,
        BOX_RADIUS_SCALE: Math.SQRT2 * 0.5,
        BOX_MARGIN_SIZE_RATIO: 0.55,
        BOX_MARGIN_WORLD_RATIO: 0.03,
        BOX_PLACEMENT_TRIES: 36,
        RESET_BOX_COUNT: 3,
        PLAYER_ID: 1,
        PLAYER_RADIUS_RATIO: 0.02,
        PLAYER_WEIGHT: 999999,
        PLAYER_KEEP_OUT_WORLD_RATIO: 0.04,
        PLAYER_KEEP_OUT_MIN_PX: 8,
        DEFAULT_ENEMY_COUNT: 100,
        ENEMY_SPAWN_MARGIN_RATIO: 0.07,
        ENEMY_RANDOM_ANGLE_MIN: 0,
        ENEMY_RANDOM_ANGLE_MAX: Math.PI * 2,
        ENEMY_SPEED_MIN: 20,
        ENEMY_SPEED_MAX: 64,
        ENEMY_MOVE_SPEED_MIN: 0.85,
        ENEMY_MOVE_SPEED_MAX: 1.2,
        ENEMY_SPEED_MULTIPLIER: 2.5,
        ENEMY_HP: 1,
        ENEMY_ATK: 1,
        ENEMY_ACC_SPEED: 0,
        ENEMY_SIZE: 1.5,
        ENEMY_PROJECTILE_HITS_TO_KILL: 3,
        ENEMY_ROTATION_MIN: 0,
        ENEMY_ROTATION_MAX: 360,
        PROJECTILE_SIZE_RATIO: 0.03,
        PROJECTILE_TRAVEL_SECONDS: 2,
        PROJECTILE_START_X_RATIO: -0.1,
        PROJECTILE_END_X_RATIO: 1.1,
        PROJECTILE_MIN_TRAVEL_SECONDS: 0.016,
        PROJECTILE_BURST_COUNT: 10,
        PROJECTILE_WEIGHT: 0.07,
        PROJECTILE_IMPACT_FORCE: 1,
        COLOR_FALLBACKS: Object.freeze({
            StaticWall: 'rgba(120, 136, 156, 0.9)',
            BoxWall: 'rgba(182, 201, 214, 0.9)',
            Player: '#4fa3ff',
            Projectile: '#ffc857',
            EnemyFill: '#ff6c6c',
            HexaBackdropFallback: 'rgb(255, 212, 184)',
            ButtonIdle: 'rgba(26, 32, 40, 0.74)',
            ButtonHover: 'rgba(26, 32, 40, 0.86)',
            ButtonStroke: 'rgba(255, 255, 255, 0.55)',
            ButtonText: '#f5f8ff'
        })
    }),
    PROJECTILE: Object.freeze({
        CULL_MARGIN_RATIO: 0.2
    }),
    BUTTON: Object.freeze({
        RADIUS: 10,
        FONT_MIN_SIZE: 11,
        FONT_WW_RATIO: 0.0092,
        TEXT_X_RATIO: 0.5,
        TEXT_Y_RATIO: 0.54,
        BORDER_LINE_WIDTH: 1,
        LAYOUT: Object.freeze({
            WIDTH_MIN: 160,
            WIDTH_WW_RATIO: 0.13,
            HEIGHT_MIN: 38,
            HEIGHT_WH_RATIO: 0.052,
            GAP_MIN: 10,
            GAP_HEIGHT_RATIO: 0.24,
            X_WW_RATIO: 0.03,
            Y_WH_RATIO: 0.08
        }),
        ACTIONS: Object.freeze([
            Object.freeze({
                id: 'spawnEnemy100',
                label: 'Spawn 100 Enemies',
                type: 'spawnEnemies',
                count: 100
            }),
            Object.freeze({
                id: 'spawnBox',
                label: 'Spawn Box',
                type: 'spawnBox'
            }),
            Object.freeze({
                id: 'spawnProjectile10',
                label: 'Spawn 10 Projectiles',
                type: 'spawnProjectiles'
            })
        ])
    })
});
