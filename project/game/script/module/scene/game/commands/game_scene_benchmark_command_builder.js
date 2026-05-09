import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import { getBenchmarkEnemyFill } from '../render/game_scene_benchmark_palette.js';

const BENCHMARK_WALL_HEIGHT_RATIO = 0.5;
const BENCHMARK_WALL_THICKNESS_RATIO = 0.008;
const BENCHMARK_BOX_SIZE_RATIO = 0.05;
const BENCHMARK_PROJECTILE_SIZE_RATIO = 0.03;
const BENCHMARK_PROJECTILE_TRAVEL_SECONDS = 2;
const BENCHMARK_ENEMY_SPEED_MULTIPLIER = 2.5;

/**
 * 지정 범위의 실수 난수를 반환합니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number}
 */
function randomBenchmarkValue(min, max) {
    return (Math.random() * (max - min)) + min;
}

/**
 * 지정 범위의 정수 난수를 반환합니다.
 * @param {number} min - 최솟값입니다.
 * @param {number} max - 최댓값입니다.
 * @returns {number}
 */
function randomBenchmarkInt(min, max) {
    return Math.floor(randomBenchmarkValue(min, max + 1));
}

/**
 * 사각형과 원의 겹침 여부를 반환합니다.
 * @param {{minX:number, maxX:number, minY:number, maxY:number}} rect - 사각 범위입니다.
 * @param {number} x - 원 중심 x 좌표입니다.
 * @param {number} y - 원 중심 y 좌표입니다.
 * @param {number} radius - 원 반지름입니다.
 * @returns {boolean}
 */
function rectCircleOverlap(rect, x, y, radius) {
    const closestX = Math.max(rect.minX, Math.min(x, rect.maxX));
    const closestY = Math.max(rect.minY, Math.min(y, rect.maxY));
    const dx = x - closestX;
    const dy = y - closestY;
    return ((dx * dx) + (dy * dy)) <= (radius * radius);
}

/**
 * 벤치마크 벽 데이터를 생성하고 씬의 벽 ID 카운터를 전진시킵니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {number} x - 중심 x 좌표입니다.
 * @param {number} y - 중심 y 좌표입니다.
 * @param {number} w - 벽 너비입니다.
 * @param {number} h - 벽 높이입니다.
 * @returns {object}
 */
function createBenchmarkWallData(scene, x, y, w, h) {
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
        if (rectCircleOverlap(rect, x, y, radius)) return true;
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
    const radius = (size * Math.SQRT2) * 0.5;
    const margin = Math.max(size * 0.55, scene.objectWH * 0.03);
    const minX = margin;
    const maxX = Math.max(minX, scene.WW - margin);
    const minY = margin;
    const maxY = Math.max(minY, scene.objectWH - margin);

    for (let tries = 0; tries < 36; tries++) {
        const x = randomBenchmarkValue(minX, maxX);
        const y = randomBenchmarkValue(minY, maxY);
        if (isBenchmarkPointBlockedByWall(scene, x, y, radius, existingWalls)) {
            continue;
        }

        if (playerLike && playerLike.position) {
            const dx = x - playerLike.position.x;
            const dy = y - playerLike.position.y;
            const keepout = Math.max((playerLike.radius || 0) + radius + (scene.objectWH * 0.04), 8);
            if (((dx * dx) + (dy * dy)) < (keepout * keepout)) {
                continue;
            }
        }

        return createBenchmarkWallData(scene, x, y, size, size);
    }

    return null;
}

/**
 * 랜덤 적 스폰 위치를 반환합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {{x:number, y:number}}
 */
function randomBenchmarkEnemySpawnPosition(scene) {
    const margin = scene.objectWH * 0.07;
    const side = randomBenchmarkInt(0, 3);

    if (side === 0) {
        return { x: randomBenchmarkValue(margin, scene.WW - margin), y: margin };
    }
    if (side === 1) {
        return { x: randomBenchmarkValue(margin, scene.WW - margin), y: scene.objectWH - margin };
    }
    if (side === 2) {
        return { x: margin, y: randomBenchmarkValue(margin, scene.objectWH - margin) };
    }
    return { x: scene.WW - margin, y: randomBenchmarkValue(margin, scene.objectWH - margin) };
}

/**
 * 현재 씬 상태와 초기 배치를 반영한 월드 교체 명령 목록을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {object[]}
 */
export function buildGameSceneResetWorldCommands(scene) {
    const playerData = {
        id: 1,
        radius: scene.objectWH * 0.02,
        position: {
            x: scene.WW * 0.5,
            y: scene.objectWH * 0.5
        },
        speed: { x: 0, y: 0 },
        weight: 999999
    };

    const wallThickness = Math.max(8, scene.WW * BENCHMARK_WALL_THICKNESS_RATIO);
    const wallHeight = scene.objectWH * BENCHMARK_WALL_HEIGHT_RATIO;
    const wallY = scene.objectWH * 0.5;
    const staticWalls = [
        createBenchmarkWallData(scene, scene.WW * 0.25, wallY, wallThickness, wallHeight),
        createBenchmarkWallData(scene, scene.WW * 0.75, wallY, wallThickness, wallHeight)
    ];
    const boxWalls = [];

    for (let i = 0; i < 3; i++) {
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
 * 적 스폰 명령을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {number} [count=100] - 생성할 적 수입니다.
 * @returns {object}
 */
export function buildGameSceneSpawnEnemiesCommand(scene, count = 100) {
    const fill = getBenchmarkEnemyFill();
    const enemies = [];
    const reservedEnemyIds = scene.objectSystem && typeof scene.objectSystem.reserveEnemyIds === 'function'
        ? scene.objectSystem.reserveEnemyIds(count)
        : [];

    for (let i = 0; i < count; i++) {
        const type = scene.enemyTypes[randomBenchmarkInt(0, scene.enemyTypes.length - 1)];
        const spawnPos = randomBenchmarkEnemySpawnPosition(scene);
        const angle = randomBenchmarkValue(0, Math.PI * 2);
        const speedMag = randomBenchmarkValue(20, 64);

        enemies.push({
            id: Number.isInteger(reservedEnemyIds[i]) ? reservedEnemyIds[i] : null,
            type,
            hp: 1,
            maxHp: 1,
            atk: 1,
            moveSpeed: randomBenchmarkValue(0.85, 1.2) * BENCHMARK_ENEMY_SPEED_MULTIPLIER,
            accSpeed: 0,
            size: 1.5,
            projectileHitsToKill: 3,
            position: spawnPos,
            speed: {
                x: Math.cos(angle) * speedMag,
                y: Math.sin(angle) * speedMag
            },
            acc: { x: 0, y: 0 },
            aiId: 'enemyAI',
            fill,
            alpha: 1,
            rotation: randomBenchmarkValue(0, 360)
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
    const radius = diameter * 0.5;
    const startX = -scene.WW * 0.1;
    const endX = scene.WW * 1.1;
    const speedX = (endX - startX) / Math.max(0.016, BENCHMARK_PROJECTILE_TRAVEL_SECONDS);
    const projectiles = [];

    for (let i = 0; i < 10; i++) {
        const y = randomBenchmarkValue(radius, Math.max(radius, scene.objectWH - radius));
        projectiles.push({
            id: scene.projIdCounter++,
            radius,
            weight: 0.07,
            impactForce: 1,
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
