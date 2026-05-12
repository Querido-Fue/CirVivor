import { getData } from 'data/data_handler.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import { isRectCircleOverlapping } from 'util/geometry_util.js';
import { randomIntInclusive, randomRange } from 'util/random_util.js';
import { getBenchmarkEnemyFill } from '../render/game_scene_benchmark_palette.js';

const BENCHMARK_CONSTANTS = getData('GAME_SCENE_CONSTANTS').BENCHMARK;
const PLAY_MAP_CONSTANTS = getData('GAME_SCENE_CONSTANTS').PLAY_MAP;
const BENCHMARK_WALL_HEIGHT_RATIO = BENCHMARK_CONSTANTS.WALL_HEIGHT_RATIO;
const BENCHMARK_WALL_THICKNESS_RATIO = BENCHMARK_CONSTANTS.WALL_THICKNESS_RATIO;
const BENCHMARK_BOX_SIZE_RATIO = BENCHMARK_CONSTANTS.BOX_SIZE_RATIO;
const BENCHMARK_PROJECTILE_SIZE_RATIO = BENCHMARK_CONSTANTS.PROJECTILE_SIZE_RATIO;
const BENCHMARK_PROJECTILE_TRAVEL_SECONDS = BENCHMARK_CONSTANTS.PROJECTILE_TRAVEL_SECONDS;
const BENCHMARK_ENEMY_SPEED_MULTIPLIER = BENCHMARK_CONSTANTS.ENEMY_SPEED_MULTIPLIER;

/**
 * 벽 데이터를 생성하고 씬의 벽 ID 카운터를 전진시킵니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {number} x - 중심 x 좌표입니다.
 * @param {number} y - 중심 y 좌표입니다.
 * @param {number} w - 벽 너비입니다.
 * @param {number} h - 벽 높이입니다.
 * @returns {object}
 */
function createGameSceneWallData(scene, x, y, w, h) {
    return {
        id: scene.wallIdCounter++,
        x,
        y,
        w,
        h,
        origin: 'center'
    };
}

/**
 * 지정 위치가 벽에 막혀 있는지 확인합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {number} x - 검사할 x 좌표입니다.
 * @param {number} y - 검사할 y 좌표입니다.
 * @param {number} radius - 검사 반지름입니다.
 * @param {object[]|null} [walls=null] - 검사할 벽 목록입니다.
 * @returns {boolean}
 */
function isBenchmarkPointBlockedByWall(scene, x, y, radius, walls = null) {
    const allWalls = Array.isArray(walls)
        ? walls
        : [...scene.staticWalls, ...scene.boxWalls];
    for (let i = 0; i < allWalls.length; i++) {
        const wall = allWalls[i];
        if (!wall || wall.active === false) continue;
        const halfW = wall.w * 0.5;
        const halfH = wall.h * 0.5;
        const rect = {
            minX: wall.x - halfW,
            maxX: wall.x + halfW,
            minY: wall.y - halfH,
            maxY: wall.y + halfH
        };
        if (isRectCircleOverlapping(rect, x, y, radius)) return true;
    }
    return false;
}

/**
 * 벤치마크 박스 벽 데이터를 랜덤 위치에 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object[]} [existingWalls=[]] - 이미 배치된 벽 목록입니다.
 * @param {{position?: {x:number, y:number}, radius?: number}|null} [playerLike=null] - 플레이어 충돌체 요약입니다.
 * @returns {object|null}
 */
function buildRandomBenchmarkBoxWallData(scene, existingWalls = [], playerLike = null) {
    const size = scene.objectWH * BENCHMARK_BOX_SIZE_RATIO;
    const radius = size * BENCHMARK_CONSTANTS.BOX_RADIUS_SCALE;
    const margin = Math.max(
        size * BENCHMARK_CONSTANTS.BOX_MARGIN_SIZE_RATIO,
        scene.objectWH * BENCHMARK_CONSTANTS.BOX_MARGIN_WORLD_RATIO
    );
    const minX = margin;
    const maxX = Math.max(minX, scene.WW - margin);
    const minY = margin;
    const maxY = Math.max(minY, scene.objectWH - margin);

    for (let tries = 0; tries < BENCHMARK_CONSTANTS.BOX_PLACEMENT_TRIES; tries++) {
        const x = randomRange(minX, maxX);
        const y = randomRange(minY, maxY);
        if (isBenchmarkPointBlockedByWall(scene, x, y, radius, existingWalls)) {
            continue;
        }

        if (playerLike && playerLike.position) {
            const dx = x - playerLike.position.x;
            const dy = y - playerLike.position.y;
            const keepout = Math.max(
                (playerLike.radius || 0) + radius + (scene.objectWH * BENCHMARK_CONSTANTS.PLAYER_KEEP_OUT_WORLD_RATIO),
                BENCHMARK_CONSTANTS.PLAYER_KEEP_OUT_MIN_PX
            );
            if (((dx * dx) + (dy * dy)) < (keepout * keepout)) {
                continue;
            }
        }

        return createGameSceneWallData(scene, x, y, size, size);
    }

    return null;
}

/**
 * 플레이용 맵 벽 정의를 실제 벽 데이터로 변환합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} wallDefinition - 비율 기반 벽 정의입니다.
 * @returns {object}
 */
function buildPlayMapStaticWallData(scene, wallDefinition) {
    const width = Math.max(
        PLAY_MAP_CONSTANTS.WALL_MIN_THICKNESS,
        scene.WW * wallDefinition.WIDTH_WW_RATIO
    );
    const height = Math.max(
        PLAY_MAP_CONSTANTS.WALL_MIN_THICKNESS,
        scene.objectWH * wallDefinition.HEIGHT_WH_RATIO
    );

    return createGameSceneWallData(
        scene,
        scene.WW * wallDefinition.X_RATIO,
        scene.objectWH * wallDefinition.Y_RATIO,
        width,
        height
    );
}

/**
 * 플레이용 박스 벽 정의를 실제 벽 데이터로 변환합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} boxDefinition - 비율 기반 박스 위치 정의입니다.
 * @returns {object}
 */
function buildPlayMapBoxWallData(scene, boxDefinition) {
    const size = Math.max(
        PLAY_MAP_CONSTANTS.WALL_MIN_THICKNESS,
        scene.objectWH * PLAY_MAP_CONSTANTS.BOX_SIZE_RATIO
    );

    return createGameSceneWallData(
        scene,
        scene.WW * boxDefinition.X_RATIO,
        scene.objectWH * boxDefinition.Y_RATIO,
        size,
        size
    );
}

/**
 * 랜덤 적 스폰 위치를 반환합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {{x:number, y:number}}
 */
function randomBenchmarkEnemySpawnPosition(scene) {
    const margin = scene.objectWH * BENCHMARK_CONSTANTS.ENEMY_SPAWN_MARGIN_RATIO;
    const side = randomIntInclusive(0, 3);

    if (side === 0) {
        return { x: randomRange(margin, scene.WW - margin), y: margin };
    }
    if (side === 1) {
        return { x: randomRange(margin, scene.WW - margin), y: scene.objectWH - margin };
    }
    if (side === 2) {
        return { x: margin, y: randomRange(margin, scene.objectWH - margin) };
    }
    return { x: scene.WW - margin, y: randomRange(margin, scene.objectWH - margin) };
}

/**
 * 현재 씬 상태와 초기 배치를 반영한 월드 교체 명령 목록을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {object[]}
 */
export function buildGameSceneResetBenchmarkWorldCommands(scene) {
    const playerData = {
        id: BENCHMARK_CONSTANTS.PLAYER_ID,
        radius: scene.objectWH * BENCHMARK_CONSTANTS.PLAYER_RADIUS_RATIO,
        position: {
            x: scene.WW * BENCHMARK_CONSTANTS.WORLD_CENTER_RATIO,
            y: scene.objectWH * BENCHMARK_CONSTANTS.WORLD_CENTER_RATIO
        },
        speed: { x: 0, y: 0 },
        weight: BENCHMARK_CONSTANTS.PLAYER_WEIGHT
    };

    const wallThickness = Math.max(BENCHMARK_CONSTANTS.WALL_MIN_THICKNESS, scene.WW * BENCHMARK_WALL_THICKNESS_RATIO);
    const wallHeight = scene.objectWH * BENCHMARK_WALL_HEIGHT_RATIO;
    const wallY = scene.objectWH * BENCHMARK_CONSTANTS.WORLD_CENTER_RATIO;
    const staticWalls = BENCHMARK_CONSTANTS.STATIC_WALL_X_RATIOS.map((ratio) => {
        return createGameSceneWallData(scene, scene.WW * ratio, wallY, wallThickness, wallHeight);
    });
    const boxWalls = [];

    for (let i = 0; i < BENCHMARK_CONSTANTS.RESET_BOX_COUNT; i++) {
        const wallData = buildRandomBenchmarkBoxWallData(scene, [...staticWalls, ...boxWalls], playerData);
        if (wallData) {
            boxWalls.push(wallData);
        }
    }

    return [{
        type: GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD,
        player: playerData,
        staticWalls,
        boxWalls,
        projectiles: [],
        nextWallIdCounter: scene.wallIdCounter,
        nextProjIdCounter: scene.projIdCounter
    }];
}

/**
 * 기본 게임 씬의 간단한 플레이 맵 교체 명령을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {object[]}
 */
export function buildGameSceneResetPlayWorldCommands(scene) {
    const playerData = {
        id: PLAY_MAP_CONSTANTS.PLAYER_ID,
        radius: scene.objectWH * PLAY_MAP_CONSTANTS.PLAYER_RADIUS_RATIO,
        position: {
            x: scene.WW * PLAY_MAP_CONSTANTS.PLAYER_POSITION.X_RATIO,
            y: scene.objectWH * PLAY_MAP_CONSTANTS.PLAYER_POSITION.Y_RATIO
        },
        speed: { x: 0, y: 0 },
        weight: PLAY_MAP_CONSTANTS.PLAYER_WEIGHT
    };
    const staticWalls = PLAY_MAP_CONSTANTS.STATIC_WALLS.map((wallDefinition) => {
        return buildPlayMapStaticWallData(scene, wallDefinition);
    });
    const boxWalls = PLAY_MAP_CONSTANTS.BOX_POSITIONS.map((boxDefinition) => {
        return buildPlayMapBoxWallData(scene, boxDefinition);
    });

    return [{
        type: GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD,
        player: playerData,
        staticWalls,
        boxWalls,
        projectiles: [],
        nextWallIdCounter: scene.wallIdCounter,
        nextProjIdCounter: scene.projIdCounter
    }];
}

/**
 * 적 스폰 명령을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {number} [count=100] - 생성할 적 수입니다.
 * @returns {object}
 */
export function buildGameSceneSpawnEnemiesCommand(scene, count = BENCHMARK_CONSTANTS.DEFAULT_ENEMY_COUNT) {
    const fill = getBenchmarkEnemyFill();
    const enemies = [];
    const reservedEnemyIds = scene.objectSystem && typeof scene.objectSystem.reserveEnemyIds === 'function'
        ? scene.objectSystem.reserveEnemyIds(count)
        : [];

    for (let i = 0; i < count; i++) {
        const type = scene.enemyTypes[randomIntInclusive(0, scene.enemyTypes.length - 1)];
        const spawnPos = randomBenchmarkEnemySpawnPosition(scene);
        const angle = randomRange(
            BENCHMARK_CONSTANTS.ENEMY_RANDOM_ANGLE_MIN,
            BENCHMARK_CONSTANTS.ENEMY_RANDOM_ANGLE_MAX
        );
        const speedMag = randomRange(BENCHMARK_CONSTANTS.ENEMY_SPEED_MIN, BENCHMARK_CONSTANTS.ENEMY_SPEED_MAX);

        enemies.push({
            id: Number.isInteger(reservedEnemyIds[i]) ? reservedEnemyIds[i] : null,
            type,
            hp: BENCHMARK_CONSTANTS.ENEMY_HP,
            maxHp: BENCHMARK_CONSTANTS.ENEMY_HP,
            atk: BENCHMARK_CONSTANTS.ENEMY_ATK,
            moveSpeed: randomRange(
                BENCHMARK_CONSTANTS.ENEMY_MOVE_SPEED_MIN,
                BENCHMARK_CONSTANTS.ENEMY_MOVE_SPEED_MAX
            ) * BENCHMARK_ENEMY_SPEED_MULTIPLIER,
            accSpeed: BENCHMARK_CONSTANTS.ENEMY_ACC_SPEED,
            size: BENCHMARK_CONSTANTS.ENEMY_SIZE,
            projectileHitsToKill: BENCHMARK_CONSTANTS.ENEMY_PROJECTILE_HITS_TO_KILL,
            position: spawnPos,
            speed: {
                x: Math.cos(angle) * speedMag,
                y: Math.sin(angle) * speedMag
            },
            acc: { x: 0, y: 0 },
            aiId: 'enemyAI',
            fill,
            alpha: 1,
            rotation: randomRange(BENCHMARK_CONSTANTS.ENEMY_ROTATION_MIN, BENCHMARK_CONSTANTS.ENEMY_ROTATION_MAX)
        });
    }

    return {
        type: GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH,
        enemies,
        nextEnemyIdCounter: scene.objectSystem && typeof scene.objectSystem.getEnemyIdCounter === 'function'
            ? scene.objectSystem.getEnemyIdCounter()
            : null
    };
}

/**
 * 맵 임의 위치에 추가할 박스 벽 명령을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {object|null}
 */
export function buildGameSceneSpawnRandomBoxCommand(scene) {
    const wallData = buildRandomBenchmarkBoxWallData(
        scene,
        [...scene.staticWalls, ...scene.boxWalls],
        scene.player
    );
    if (!wallData) {
        return null;
    }

    return {
        type: GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS,
        walls: [wallData],
        nextWallIdCounter: scene.wallIdCounter
    };
}

/**
 * 투사체 일괄 생성 명령을 구성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {object}
 */
export function buildGameSceneSpawnProjectileBurstCommand(scene) {
    const diameter = scene.objectWH * BENCHMARK_PROJECTILE_SIZE_RATIO;
    const radius = diameter * BENCHMARK_CONSTANTS.WORLD_CENTER_RATIO;
    const startX = scene.WW * BENCHMARK_CONSTANTS.PROJECTILE_START_X_RATIO;
    const endX = scene.WW * BENCHMARK_CONSTANTS.PROJECTILE_END_X_RATIO;
    const speedX = (endX - startX) / Math.max(
        BENCHMARK_CONSTANTS.PROJECTILE_MIN_TRAVEL_SECONDS,
        BENCHMARK_PROJECTILE_TRAVEL_SECONDS
    );
    const projectiles = [];

    for (let i = 0; i < BENCHMARK_CONSTANTS.PROJECTILE_BURST_COUNT; i++) {
        const y = randomRange(radius, Math.max(radius, scene.objectWH - radius));
        projectiles.push({
            id: scene.projIdCounter++,
            radius,
            weight: BENCHMARK_CONSTANTS.PROJECTILE_WEIGHT,
            impactForce: BENCHMARK_CONSTANTS.PROJECTILE_IMPACT_FORCE,
            piercing: true,
            position: { x: startX, y },
            speed: { x: speedX, y: 0 }
        });
    }

    return {
        type: GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES,
        projectiles,
        nextProjIdCounter: scene.projIdCounter
    };
}
