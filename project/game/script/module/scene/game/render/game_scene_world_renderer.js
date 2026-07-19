import { ColorSchemes } from 'display/_theme_handler.js';
import { renderGL, renderGLShapeInstances } from 'display/display_system.js';
import { beginPerformanceSection, endPerformanceSection } from 'debug/debug_system.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

const WORLD_OBJECT_LAYER = 'object';
const WORLD_BACKGROUND_LAYER = 'background';
const WORLD_CIRCLE_ALPHA = 0.95;
const EMPTY_WORLD_RENDER_OPTIONS = Object.freeze({});
const EMPTY_WORLD_ENTITY_LIST = Object.freeze([]);
const WORLD_RENDER_STATE_SCRATCH = {
    mapGeometry: null,
    staticWalls: [],
    boxWalls: [],
    player: null,
    projectiles: [],
    offsetY: 0
};
const WORLD_MAP_GRID_RENDER_OPTIONS = {
    shape: 'square',
    w: 0,
    h: 0,
    fill: null
};
const WORLD_MAP_FLOOR_RENDER_OPTIONS = {
    shape: 'square',
    w: 0,
    h: 0,
    fill: null
};
const WORLD_MAP_GRID_VERTEX_CACHE_KEY = Object.freeze({});
const WORLD_MAP_FLOOR_VERTEX_CACHE_KEY = Object.freeze({});
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
    MAP: 'scene.game.world.map',
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
 * @param {object} out - 필드를 제자리 갱신할 writable 호출자 소유 결과 객체입니다.
 * @returns {{mapGeometry: object|null, staticWalls: object[], boxWalls: object[], player: object|null|undefined, projectiles: object[], offsetY: number}} `out`과 동일한 객체입니다. 선택된 맵·플레이어 객체와 유효한 입력 엔티티 배열은 복제하지 않고 live 참조로 유지합니다. 기존의 다른 필드는 유지하고, 예외 전까지 완료된 필드 쓰기도 남깁니다.
 */
function resolveWorldRenderState(options, out) {
    const source = options || EMPTY_WORLD_RENDER_OPTIONS;
    const sceneSnapshot = source?.sceneSnapshot ?? null;

    out.mapGeometry = resolveWorldSnapshotField(sceneSnapshot, source, 'mapGeometry') || null;
    out.staticWalls = resolveWorldSnapshotArray(sceneSnapshot, source, 'staticWalls');
    out.boxWalls = resolveWorldSnapshotArray(sceneSnapshot, source, 'boxWalls');
    out.player = resolveWorldSnapshotField(sceneSnapshot, source, 'player');
    out.projectiles = resolveWorldSnapshotArray(sceneSnapshot, source, 'projectiles');
    out.offsetY = normalizeSnapshotNumber(source?.objectOffsetY, 0);
    return out;
}

/**
 * 현재 테마의 맵 색상을 반환합니다.
 * @param {'Floor'|'Grid'} key - 조회할 맵 색상 키입니다.
 * @param {string} fallback - 맵 전용 색상이 없을 때 사용할 색상입니다.
 * @returns {string} 렌더링할 색상입니다.
 */
function getGameMapColor(key, fallback) {
    const color = ColorSchemes?.Game?.Map?.[key];
    return typeof color === 'string' && color.length > 0 ? color : fallback;
}

/**
 * 그리드 맵의 보행 가능 바닥을 background 레이어에 일괄 렌더합니다.
 * @param {object|null|undefined} mapGeometry - 컴파일된 맵 렌더 지오메트리입니다.
 * @param {number} offsetY - 오브젝트 월드의 화면 Y 오프셋입니다.
 * @returns {void}
 */
function renderGameMap(mapGeometry, offsetY) {
    const centers = mapGeometry?.floorLocalCenters;
    const cellSize = normalizeSnapshotNumber(mapGeometry?.cellSize, 0);
    if (!Array.isArray(centers) || centers.length === 0 || cellSize <= 0) {
        return;
    }

    const originX = normalizeSnapshotNumber(mapGeometry.originX, 0);
    const originY = normalizeSnapshotNumber(mapGeometry.originY, 0) - offsetY;
    const tileGapRatio = Math.min(
        0.45,
        Math.max(0, normalizeSnapshotNumber(mapGeometry.tileGapRatio, 0))
    );
    const floorSize = cellSize * (1 - (tileGapRatio * 2));

    const gridOptions = WORLD_MAP_GRID_RENDER_OPTIONS;
    gridOptions.w = cellSize;
    gridOptions.h = cellSize;
    gridOptions.fill = getGameMapColor('Grid', getBenchmarkColor('StaticWall'));
    renderGLShapeInstances(
        WORLD_BACKGROUND_LAYER,
        gridOptions,
        centers,
        originX,
        originY,
        cellSize,
        WORLD_MAP_GRID_VERTEX_CACHE_KEY
    );

    const floorOptions = WORLD_MAP_FLOOR_RENDER_OPTIONS;
    floorOptions.w = floorSize;
    floorOptions.h = floorSize;
    floorOptions.fill = getGameMapColor('Floor', getBenchmarkColor('BoxWall'));
    renderGLShapeInstances(
        WORLD_BACKGROUND_LAYER,
        floorOptions,
        centers,
        originX,
        originY,
        cellSize,
        WORLD_MAP_FLOOR_VERTEX_CACHE_KEY
    );
}

/**
 * 벽 엔티티를 렌더합니다.
 * @param {object|null|undefined} wall - 벽 엔티티 또는 스냅샷입니다.
 * @param {string} fill - 렌더링할 색상입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 * @returns {void}
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
 * @returns {void}
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
 * @returns {void}
 */
function renderPlayer(player, offsetY) {
    renderCircleEntity(player, getBenchmarkColor('Player'), offsetY);
}

/**
 * 투사체 엔티티를 렌더합니다.
 * @param {object|null|undefined} projectile - 투사체 엔티티 또는 스냅샷입니다.
 * @param {string} fill - 렌더링할 색상입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 * @returns {void}
 */
function renderProjectile(projectile, fill, offsetY) {
    renderCircleEntity(projectile, fill, offsetY);
}

/**
 * 일반 씬 오브젝트 목록을 렌더합니다.
 * @param {{sceneSnapshot?: object|null, mapGeometry?: object|null, staticWalls?: object[], boxWalls?: object[], player?: object|null, projectiles?: object[], objectOffsetY?: number}} [options={}] - 렌더 옵션입니다.
 * @returns {void}
 */
export function drawGameSceneWorldObjects(options = EMPTY_WORLD_RENDER_OPTIONS) {
    const {
        mapGeometry,
        staticWalls,
        boxWalls,
        player,
        projectiles,
        offsetY
    } = resolveWorldRenderState(options, WORLD_RENDER_STATE_SCRATCH);

    let startTime = beginPerformanceSection();
    renderGameMap(mapGeometry, offsetY);
    endPerformanceSection(WORLD_RENDER_SECTIONS.MAP, startTime);

    startTime = beginPerformanceSection();
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

    WORLD_RENDER_STATE_SCRATCH.mapGeometry = null;
    WORLD_RENDER_STATE_SCRATCH.staticWalls = EMPTY_WORLD_ENTITY_LIST;
    WORLD_RENDER_STATE_SCRATCH.boxWalls = EMPTY_WORLD_ENTITY_LIST;
    WORLD_RENDER_STATE_SCRATCH.player = null;
    WORLD_RENDER_STATE_SCRATCH.projectiles = EMPTY_WORLD_ENTITY_LIST;
}
