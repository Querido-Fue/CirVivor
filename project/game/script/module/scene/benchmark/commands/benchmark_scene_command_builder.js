import { isRectCircleOverlapping } from 'util/geometry_util.js';
import { randomRange } from 'util/random_util.js';
import {
    BENCHMARK_SCENE_COMMAND_TYPES
} from './benchmark_scene_command_protocol.js';
import {
    GPU_BENCHMARK_ARENA_LAYOUT
} from '../gpu_benchmark_navigation_source.js';

const BENCHMARK_CONSTANTS = Object.freeze({
    BOX_SIZE_RATIO: 0.05,
    BOX_RADIUS_SCALE: Math.SQRT2 * 0.5,
    BOX_MARGIN_SIZE_RATIO: 0.55,
    BOX_MARGIN_WORLD_RATIO: 0.03,
    BOX_PLACEMENT_TRIES: 36,
    PLAYER_ID: 1,
    PLAYER_WEIGHT: 999999,
    PLAYER_KEEP_OUT_WORLD_RATIO: 0.04,
    PLAYER_KEEP_OUT_MIN_PX: 8,
    DEFAULT_GPU_ENEMY_COUNT: 100,
    DEFAULT_GPU_PROJECTILE_COUNT: 10
});

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

function resolveBenchmarkArenaProjection(scene) {
    const worldProjection = scene.getGpuWorldViewProjection?.();
    if (worldProjection
        && typeof worldProjection.worldToViewport === 'function'
        && typeof worldProjection.getScale === 'function') {
        const origin = worldProjection.worldToViewport(0, 0, {});
        const scale = Number(worldProjection.getScale());
        const originX = Number(origin?.x);
        const originY = Number(origin?.y);
        const objectOffsetY = Number(scene.objectOffsetY);
        if (Number.isFinite(scale)
            && scale > 0
            && Number.isFinite(originX)
            && Number.isFinite(originY)) {
            return {
                scale,
                offsetX: originX,
                offsetY: originY
                    + (Number.isFinite(objectOffsetY) ? objectOffsetY : 0)
            };
        }
    }

    const bounds = GPU_BENCHMARK_ARENA_LAYOUT.worldBounds;
    const scale = Math.min(
        scene.WW / bounds.width,
        scene.objectWH / bounds.height
    );
    return {
        scale,
        offsetX: (scene.WW - (bounds.width * scale)) * 0.5,
        offsetY: (scene.objectWH - (bounds.height * scale)) * 0.5
    };
}

function projectBenchmarkArenaPoint(projection, point) {
    return {
        x: projection.offsetX + (point.x * projection.scale),
        y: projection.offsetY + (point.y * projection.scale)
    };
}

function projectBenchmarkArenaRectangle(scene, projection, rectangle) {
    const position = projectBenchmarkArenaPoint(projection, rectangle);
    return createBenchmarkWallData(
        scene,
        position.x,
        position.y,
        rectangle.w * projection.scale,
        rectangle.h * projection.scale
    );
}

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

function buildRandomBenchmarkBoxWallData(scene, existingWalls = [], playerLike = null) {
    const size = scene.objectWH * BENCHMARK_CONSTANTS.BOX_SIZE_RATIO;
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

        if (playerLike?.position) {
            const dx = x - playerLike.position.x;
            const dy = y - playerLike.position.y;
            const keepout = Math.max(
                (playerLike.radius || 0) + radius
                    + (scene.objectWH * BENCHMARK_CONSTANTS.PLAYER_KEEP_OUT_WORLD_RATIO),
                BENCHMARK_CONSTANTS.PLAYER_KEEP_OUT_MIN_PX
            );
            if (((dx * dx) + (dy * dy)) < (keepout * keepout)) {
                continue;
            }
        }

        return createBenchmarkWallData(scene, x, y, size, size);
    }

    return null;
}

/**
 * GPU 월드 위에 유지할 CPU 보조 플레이어·벽 상태를 초기화합니다.
 * CPU 적은 이 command graph에 존재하지 않습니다.
 * @param {object} scene - BenchmarkScene입니다.
 * @returns {object[]}
 */
export function buildBenchmarkSceneResetAuxiliaryWorldCommands(scene) {
    const arenaProjection = resolveBenchmarkArenaProjection(scene);
    const targetPosition = projectBenchmarkArenaPoint(
        arenaProjection,
        GPU_BENCHMARK_ARENA_LAYOUT.playerCollider.position
    );
    const playerData = {
        id: BENCHMARK_CONSTANTS.PLAYER_ID,
        radius: GPU_BENCHMARK_ARENA_LAYOUT.playerCollider.radius
            * arenaProjection.scale,
        position: targetPosition,
        speed: { x: 0, y: 0 },
        weight: BENCHMARK_CONSTANTS.PLAYER_WEIGHT
    };
    const staticWalls = GPU_BENCHMARK_ARENA_LAYOUT.staticWalls.map(
        (rectangle) => projectBenchmarkArenaRectangle(
            scene,
            arenaProjection,
            rectangle
        )
    );
    const boxWalls = GPU_BENCHMARK_ARENA_LAYOUT.initialBoxes.map(
        (rectangle) => projectBenchmarkArenaRectangle(
            scene,
            arenaProjection,
            rectangle
        )
    );

    return [{
        type: BENCHMARK_SCENE_COMMAND_TYPES.REPLACE_AUXILIARY_WORLD,
        player: playerData,
        staticWalls,
        boxWalls,
        projectiles: [],
        nextWallIdCounter: scene.wallIdCounter
    }];
}

/**
 * 다음 frame-boundary drain에서 GPU endpoint에 예약할 적 수를 담습니다.
 * @param {number} [count=100] - GPU로 생성할 적 수입니다.
 * @returns {object|null}
 */
export function buildBenchmarkSceneSpawnGpuEnemiesCommand(
    count = BENCHMARK_CONSTANTS.DEFAULT_GPU_ENEMY_COUNT
) {
    const resolvedCount = Number(count);
    if (!Number.isSafeInteger(resolvedCount) || resolvedCount <= 0) {
        return null;
    }
    return Object.freeze({
        type: BENCHMARK_SCENE_COMMAND_TYPES.SPAWN_GPU_ENEMY_BATCH,
        count: resolvedCount
    });
}

/**
 * CPU 보조 월드에 임의 박스 벽 하나를 추가합니다.
 * 이 벽은 GPU SDF에 반영되지 않으므로 GPU 적의 장애물은 아닙니다.
 * @param {object} scene - BenchmarkScene입니다.
 * @returns {object|null}
 */
export function buildBenchmarkSceneSpawnRandomBoxCommand(scene) {
    const wallData = buildRandomBenchmarkBoxWallData(
        scene,
        [...scene.staticWalls, ...scene.boxWalls],
        scene.player
    );
    if (!wallData) return null;
    return {
        type: BENCHMARK_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS,
        walls: [wallData],
        nextWallIdCounter: scene.wallIdCounter
    };
}

/**
 * 다음 frame-boundary drain에서 mixed-body GPU endpoint에 예약할 투사체 수입니다.
 * @param {number} [count=10] - 중앙 목표에서 방사형으로 생성할 GPU 투사체 수입니다.
 * @returns {object|null}
 */
export function buildBenchmarkSceneSpawnGpuProjectileBatchCommand(
    count = BENCHMARK_CONSTANTS.DEFAULT_GPU_PROJECTILE_COUNT
) {
    const resolvedCount = Number(count);
    if (!Number.isSafeInteger(resolvedCount) || resolvedCount <= 0) {
        return null;
    }
    return Object.freeze({
        type: BENCHMARK_SCENE_COMMAND_TYPES.SPAWN_GPU_PROJECTILE_BATCH,
        count: resolvedCount
    });
}
