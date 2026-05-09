import { renderGL } from 'display/display_system.js';
import { measurePerformanceSection } from 'debug/debug_system.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

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

    renderGL('object', {
        shape: 'rect',
        x: normalizeSnapshotNumber(wall.x, 0),
        y: normalizeSnapshotNumber(wall.y, 0) - offsetY,
        w: normalizeSnapshotNumber(wall.w, 0),
        h: normalizeSnapshotNumber(wall.h, 0),
        fill: getBenchmarkColor(fillKey)
    });
}

/**
 * 플레이어 엔티티를 렌더합니다.
 * @param {object|null|undefined} player - 플레이어 엔티티 또는 스냅샷입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderPlayer(player, offsetY) {
    if (!player || player.active === false) {
        return;
    }

    const diameter = normalizeSnapshotNumber(player.radius, 0) * 2;
    renderGL('object', {
        shape: 'circle',
        x: normalizeSnapshotNumber(player.position?.x, 0),
        y: normalizeSnapshotNumber(player.position?.y, 0) - offsetY,
        w: diameter,
        h: diameter,
        fill: getBenchmarkColor('Player'),
        alpha: 0.95
    });
}

/**
 * 투사체 엔티티를 렌더합니다.
 * @param {object|null|undefined} projectile - 투사체 엔티티 또는 스냅샷입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderProjectile(projectile, offsetY) {
    if (!projectile || projectile.active === false) {
        return;
    }

    const diameter = normalizeSnapshotNumber(projectile.radius, 0) * 2;
    renderGL('object', {
        shape: 'circle',
        x: normalizeSnapshotNumber(projectile.position?.x, 0),
        y: normalizeSnapshotNumber(projectile.position?.y, 0) - offsetY,
        w: diameter,
        h: diameter,
        fill: getBenchmarkColor('Projectile'),
        alpha: 0.95
    });
}

/**
 * 일반 씬 오브젝트 목록을 렌더합니다.
 * @param {{sceneSnapshot?: object|null, staticWalls?: object[], boxWalls?: object[], player?: object|null, projectiles?: object[], objectOffsetY?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneWorldObjects(options = {}) {
    const sceneSnapshot = options?.sceneSnapshot ?? null;
    const staticWalls = Array.isArray(sceneSnapshot?.staticWalls)
        ? sceneSnapshot.staticWalls
        : (Array.isArray(options?.staticWalls) ? options.staticWalls : []);
    const boxWalls = Array.isArray(sceneSnapshot?.boxWalls)
        ? sceneSnapshot.boxWalls
        : (Array.isArray(options?.boxWalls) ? options.boxWalls : []);
    const player = sceneSnapshot && Object.prototype.hasOwnProperty.call(sceneSnapshot, 'player')
        ? sceneSnapshot.player
        : options?.player;
    const projectiles = Array.isArray(sceneSnapshot?.projectiles)
        ? sceneSnapshot.projectiles
        : (Array.isArray(options?.projectiles) ? options.projectiles : []);
    const offsetY = normalizeSnapshotNumber(options?.objectOffsetY, 0);

    measurePerformanceSection('scene.game.world.staticWalls', () => {
        for (let i = 0; i < staticWalls.length; i++) {
            renderWall(staticWalls[i], 'StaticWall', offsetY);
        }
    });

    measurePerformanceSection('scene.game.world.boxWalls', () => {
        for (let i = 0; i < boxWalls.length; i++) {
            renderWall(boxWalls[i], 'BoxWall', offsetY);
        }
    });

    measurePerformanceSection('scene.game.world.player', () => {
        renderPlayer(player, offsetY);
    });

    measurePerformanceSection('scene.game.world.projectiles', () => {
        for (let i = 0; i < projectiles.length; i++) {
            renderProjectile(projectiles[i], offsetY);
        }
    });
}
