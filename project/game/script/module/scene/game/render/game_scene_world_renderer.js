import { renderGL } from 'display/display_system.js';
import { measurePerformanceSection } from 'debug/debug_system.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

const WORLD_OBJECT_LAYER = 'object';
const WORLD_CIRCLE_ALPHA = 0.95;
const WORLD_RENDER_SECTIONS = Object.freeze({
    STATIC_WALLS: 'scene.game.world.staticWalls',
    BOX_WALLS: 'scene.game.world.boxWalls',
    PLAYER: 'scene.game.world.player',
    PROJECTILES: 'scene.game.world.projectiles'
});

/**
 * 스냅샷 배열이 있으면 우선 사용하고, 없으면 렌더 옵션 배열로 fallback합니다.
 * @param {object|null} sceneSnapshot - 씬 스냅샷입니다.
 * @param {object} options - 렌더 옵션입니다.
 * @param {string} key - 조회할 배열 키입니다.
 * @returns {object[]} 렌더에 사용할 배열입니다.
 */
function resolveWorldSnapshotArray(sceneSnapshot, options, key) {
    if (Array.isArray(sceneSnapshot?.[key])) {
        return sceneSnapshot[key];
    }
    if (Array.isArray(options?.[key])) {
        return options[key];
    }
    return [];
}

/**
 * 스냅샷 필드가 있으면 null 값까지 보존하고, 없으면 렌더 옵션 값을 사용합니다.
 * @param {object|null} sceneSnapshot - 씬 스냅샷입니다.
 * @param {object} options - 렌더 옵션입니다.
 * @param {string} key - 조회할 필드 키입니다.
 * @returns {*} 렌더에 사용할 필드 값입니다.
 */
function resolveWorldSnapshotField(sceneSnapshot, options, key) {
    if (sceneSnapshot && Object.prototype.hasOwnProperty.call(sceneSnapshot, key)) {
        return sceneSnapshot[key];
    }
    return options?.[key];
}

/**
 * 일반 씬 월드 렌더 옵션을 스냅샷 우선 규칙으로 정규화합니다.
 * @param {object|null|undefined} options - 렌더 옵션입니다.
 * @returns {{staticWalls: object[], boxWalls: object[], player: object|null|undefined, projectiles: object[], offsetY: number}}
 */
function resolveWorldRenderState(options) {
    const source = options || {};
    const sceneSnapshot = source?.sceneSnapshot ?? null;

    return {
        staticWalls: resolveWorldSnapshotArray(sceneSnapshot, source, 'staticWalls'),
        boxWalls: resolveWorldSnapshotArray(sceneSnapshot, source, 'boxWalls'),
        player: resolveWorldSnapshotField(sceneSnapshot, source, 'player'),
        projectiles: resolveWorldSnapshotArray(sceneSnapshot, source, 'projectiles'),
        offsetY: normalizeSnapshotNumber(source?.objectOffsetY, 0)
    };
}

/**
 * 벽 엔티티를 렌더합니다.
 * @param {object|null|undefined} wall - 벽 엔티티 또는 스냅샷입니다.
 * @param {string} fillKey - 벤치마크 색상 키입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderWall(wall, fillKey, offsetY) {
    if (!wall || wall.active === false) {
        return;
    }

    renderGL(WORLD_OBJECT_LAYER, {
        shape: 'rect',
        x: normalizeSnapshotNumber(wall.x, 0),
        y: normalizeSnapshotNumber(wall.y, 0) - offsetY,
        w: normalizeSnapshotNumber(wall.w, 0),
        h: normalizeSnapshotNumber(wall.h, 0),
        fill: getBenchmarkColor(fillKey)
    });
}

/**
 * 원형 월드 엔티티를 렌더합니다.
 * @param {object|null|undefined} entity - 원형 엔티티 또는 스냅샷입니다.
 * @param {string} fillKey - 벤치마크 색상 키입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderCircleEntity(entity, fillKey, offsetY) {
    if (!entity || entity.active === false) {
        return;
    }

    const diameter = normalizeSnapshotNumber(entity.radius, 0) * 2;
    renderGL(WORLD_OBJECT_LAYER, {
        shape: 'circle',
        x: normalizeSnapshotNumber(entity.position?.x, 0),
        y: normalizeSnapshotNumber(entity.position?.y, 0) - offsetY,
        w: diameter,
        h: diameter,
        fill: getBenchmarkColor(fillKey),
        alpha: WORLD_CIRCLE_ALPHA
    });
}

/**
 * 플레이어 엔티티를 렌더합니다.
 * @param {object|null|undefined} player - 플레이어 엔티티 또는 스냅샷입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderPlayer(player, offsetY) {
    renderCircleEntity(player, 'Player', offsetY);
}

/**
 * 투사체 엔티티를 렌더합니다.
 * @param {object|null|undefined} projectile - 투사체 엔티티 또는 스냅샷입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderProjectile(projectile, offsetY) {
    renderCircleEntity(projectile, 'Projectile', offsetY);
}

/**
 * 일반 씬 오브젝트 목록을 렌더합니다.
 * @param {{sceneSnapshot?: object|null, staticWalls?: object[], boxWalls?: object[], player?: object|null, projectiles?: object[], objectOffsetY?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneWorldObjects(options = {}) {
    const {
        staticWalls,
        boxWalls,
        player,
        projectiles,
        offsetY
    } = resolveWorldRenderState(options);

    measurePerformanceSection(WORLD_RENDER_SECTIONS.STATIC_WALLS, () => {
        for (let i = 0; i < staticWalls.length; i++) {
            renderWall(staticWalls[i], 'StaticWall', offsetY);
        }
    });

    measurePerformanceSection(WORLD_RENDER_SECTIONS.BOX_WALLS, () => {
        for (let i = 0; i < boxWalls.length; i++) {
            renderWall(boxWalls[i], 'BoxWall', offsetY);
        }
    });

    measurePerformanceSection(WORLD_RENDER_SECTIONS.PLAYER, () => {
        renderPlayer(player, offsetY);
    });

    measurePerformanceSection(WORLD_RENDER_SECTIONS.PROJECTILES, () => {
        for (let i = 0; i < projectiles.length; i++) {
            renderProjectile(projectiles[i], offsetY);
        }
    });
}
