import { renderGL } from 'display/display_system.js';
import { beginPerformanceSection, endPerformanceSection } from 'debug/debug_system.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

const WORLD_OBJECT_LAYER = 'object';
const WORLD_CIRCLE_ALPHA = 0.95;
const EMPTY_WORLD_RENDER_OPTIONS = Object.freeze({});
const EMPTY_WORLD_ENTITY_LIST = Object.freeze([]);
const WORLD_RENDER_STATE_SCRATCH = {
    staticWalls: [],
    boxWalls: [],
    player: null,
    projectiles: [],
    offsetY: 0
};
const WORLD_WALL_RENDER_OPTIONS = {
    shape: 'rect',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    fill: null
};
const WORLD_CIRCLE_RENDER_OPTIONS = {
    shape: 'circle',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    fill: null,
    alpha: WORLD_CIRCLE_ALPHA
};
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
    return EMPTY_WORLD_ENTITY_LIST;
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
function resolveWorldRenderState(options, out) {
    const source = options || EMPTY_WORLD_RENDER_OPTIONS;
    const sceneSnapshot = source?.sceneSnapshot ?? null;

    out.staticWalls = resolveWorldSnapshotArray(sceneSnapshot, source, 'staticWalls');
    out.boxWalls = resolveWorldSnapshotArray(sceneSnapshot, source, 'boxWalls');
    out.player = resolveWorldSnapshotField(sceneSnapshot, source, 'player');
    out.projectiles = resolveWorldSnapshotArray(sceneSnapshot, source, 'projectiles');
    out.offsetY = normalizeSnapshotNumber(source?.objectOffsetY, 0);
    return out;
}

/**
 * 벽 엔티티를 렌더합니다.
 * @param {object|null|undefined} wall - 벽 엔티티 또는 스냅샷입니다.
 * @param {string} fill - 렌더링할 색상입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderWall(wall, fill, offsetY) {
    if (!wall || wall.active === false) {
        return;
    }

    const renderOptions = WORLD_WALL_RENDER_OPTIONS;
    renderOptions.x = normalizeSnapshotNumber(wall.x, 0);
    renderOptions.y = normalizeSnapshotNumber(wall.y, 0) - offsetY;
    renderOptions.w = normalizeSnapshotNumber(wall.w, 0);
    renderOptions.h = normalizeSnapshotNumber(wall.h, 0);
    renderOptions.fill = fill;
    renderGL(WORLD_OBJECT_LAYER, renderOptions);
}

/**
 * 원형 월드 엔티티를 렌더합니다.
 * @param {object|null|undefined} entity - 원형 엔티티 또는 스냅샷입니다.
 * @param {string} fill - 렌더링할 색상입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderCircleEntity(entity, fill, offsetY) {
    if (!entity || entity.active === false) {
        return;
    }

    const diameter = normalizeSnapshotNumber(entity.radius, 0) * 2;
    const renderOptions = WORLD_CIRCLE_RENDER_OPTIONS;
    renderOptions.x = normalizeSnapshotNumber(entity.position?.x, 0);
    renderOptions.y = normalizeSnapshotNumber(entity.position?.y, 0) - offsetY;
    renderOptions.w = diameter;
    renderOptions.h = diameter;
    renderOptions.fill = fill;
    renderGL(WORLD_OBJECT_LAYER, renderOptions);
}

/**
 * 플레이어 엔티티를 렌더합니다.
 * @param {object|null|undefined} player - 플레이어 엔티티 또는 스냅샷입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderPlayer(player, offsetY) {
    renderCircleEntity(player, getBenchmarkColor('Player'), offsetY);
}

/**
 * 투사체 엔티티를 렌더합니다.
 * @param {object|null|undefined} projectile - 투사체 엔티티 또는 스냅샷입니다.
 * @param {string} fill - 렌더링할 색상입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 */
function renderProjectile(projectile, fill, offsetY) {
    renderCircleEntity(projectile, fill, offsetY);
}

/**
 * 일반 씬 오브젝트 목록을 렌더합니다.
 * @param {{sceneSnapshot?: object|null, staticWalls?: object[], boxWalls?: object[], player?: object|null, projectiles?: object[], objectOffsetY?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneWorldObjects(options = EMPTY_WORLD_RENDER_OPTIONS) {
    const {
        staticWalls,
        boxWalls,
        player,
        projectiles,
        offsetY
    } = resolveWorldRenderState(options, WORLD_RENDER_STATE_SCRATCH);

    let startTime = beginPerformanceSection();
    const staticWallFill = getBenchmarkColor('StaticWall');
    for (let i = 0; i < staticWalls.length; i++) {
        renderWall(staticWalls[i], staticWallFill, offsetY);
    }
    endPerformanceSection(WORLD_RENDER_SECTIONS.STATIC_WALLS, startTime);

    startTime = beginPerformanceSection();
    const boxWallFill = getBenchmarkColor('BoxWall');
    for (let i = 0; i < boxWalls.length; i++) {
        renderWall(boxWalls[i], boxWallFill, offsetY);
    }
    endPerformanceSection(WORLD_RENDER_SECTIONS.BOX_WALLS, startTime);

    startTime = beginPerformanceSection();
    renderPlayer(player, offsetY);
    endPerformanceSection(WORLD_RENDER_SECTIONS.PLAYER, startTime);

    startTime = beginPerformanceSection();
    const projectileFill = getBenchmarkColor('Projectile');
    for (let i = 0; i < projectiles.length; i++) {
        renderProjectile(projectiles[i], projectileFill, offsetY);
    }
    endPerformanceSection(WORLD_RENDER_SECTIONS.PROJECTILES, startTime);

    WORLD_RENDER_STATE_SCRATCH.staticWalls = EMPTY_WORLD_ENTITY_LIST;
    WORLD_RENDER_STATE_SCRATCH.boxWalls = EMPTY_WORLD_ENTITY_LIST;
    WORLD_RENDER_STATE_SCRATCH.player = null;
    WORLD_RENDER_STATE_SCRATCH.projectiles = EMPTY_WORLD_ENTITY_LIST;
}
