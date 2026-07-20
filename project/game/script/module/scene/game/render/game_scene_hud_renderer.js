import { ColorSchemes } from 'display/_theme_handler.js';
import { render } from 'display/display_system.js';
import { createFontString } from 'util/font_util.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';

/** @type {{ww: number, wh: number, titleFont: number, statsFont: number, titleFontString: string, statsFontString: string, statsX: number, statsY: number}|null} */
let cachedHudMetrics = null;
const HUD_TITLE_RENDER_OPTIONS = {
    shape: 'text',
    text: '',
    x: 0,
    y: 0,
    font: '',
    fill: '',
    align: 'left',
    baseline: 'middle'
};
const HUD_STAT_RENDER_OPTIONS = {
    shape: 'text',
    text: '',
    x: 0,
    y: 0,
    font: '',
    fill: '',
    align: 'right',
    baseline: 'bottom',
    alpha: 0.9
};

/**
 * HUD에 표시할 적 수를 계산합니다.
 * @param {object|null} sceneSnapshot - 씬 스냅샷입니다.
 * @param {object|null} objectSystem - 오브젝트 시스템입니다.
 * @returns {number}
 */
function resolveHudEnemyCount(sceneSnapshot, objectSystem) {
    if (Array.isArray(sceneSnapshot?.enemies)) {
        return sceneSnapshot.enemies.length;
    }

    return objectSystem && typeof objectSystem.getEnemies === 'function'
        ? objectSystem.getEnemies().length
        : 0;
}

/**
 * HUD 제목을 렌더합니다.
 * @param {{ww: number, wh: number, titleFont: number, titleFontString: string}} metrics - HUD 배치 값입니다.
 * @returns {void}
 */
function renderHudTitle(metrics) {
    const renderOptions = HUD_TITLE_RENDER_OPTIONS;
    renderOptions.text = 'Benchmark Scene';
    renderOptions.x = metrics.ww * 0.03;
    renderOptions.y = metrics.wh * 0.04;
    renderOptions.font = metrics.titleFontString;
    renderOptions.fill = ColorSchemes.Game.Font;
    render('ui', renderOptions);
}

/**
 * 재사용 가능한 명령 객체로 HUD 통계 한 줄을 즉시 렌더합니다.
 * @param {{statsX: number, statsFontString: string}} metrics - HUD 배치 값입니다.
 * @param {string} text - 표시할 통계 문자열입니다.
 * @param {number} y - 텍스트 기준 Y 좌표입니다.
 * @returns {void}
 */
function renderHudStatLine(metrics, text, y) {
    const renderOptions = HUD_STAT_RENDER_OPTIONS;
    renderOptions.text = text;
    renderOptions.x = metrics.statsX;
    renderOptions.y = y;
    renderOptions.font = metrics.statsFontString;
    renderOptions.fill = ColorSchemes.Game.Font;
    render('ui', renderOptions);
}

/**
 * 적 수 텍스트를 렌더합니다.
 * @param {{statsX: number, statsY: number, statsFont: number, statsFontString: string}} metrics - HUD 배치 값입니다.
 * @param {number} enemyCount - 표시할 적 수입니다.
 * @returns {void}
 */
function renderHudEnemyCount(metrics, enemyCount) {
    renderHudStatLine(metrics, `enemy count: ${enemyCount}`, metrics.statsY);
}

/**
 * 충돌 통계 텍스트를 렌더합니다.
 * @param {{statsX: number, statsY: number, statsFont: number, statsFontString: string}} metrics - HUD 배치 값입니다.
 * @param {object|null|undefined} collisionStats - 충돌 통계입니다.
 * @returns {void}
 */
function renderHudCollisionStats(metrics, collisionStats) {
    renderHudStatLine(
        metrics,
        `Collision check count: ${normalizeSnapshotNumber(collisionStats?.collisionCheckCount, 0)}`,
        metrics.statsY - (metrics.statsFont * 5.12)
    );
    renderHudStatLine(
        metrics,
        `AABB pass: ${normalizeSnapshotNumber(collisionStats?.aabbPassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.aabbRejectCount, 0)}`,
        metrics.statsY - (metrics.statsFont * 3.84)
    );
    renderHudStatLine(
        metrics,
        `Circle pass: ${normalizeSnapshotNumber(collisionStats?.circlePassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.circleRejectCount, 0)}`,
        metrics.statsY - (metrics.statsFont * 2.56)
    );
    renderHudStatLine(
        metrics,
        `Part check: ${normalizeSnapshotNumber(collisionStats?.partChecks, 0)}`,
        metrics.statsY - (metrics.statsFont * 1.28)
    );
}

/**
 * HUD 배치 값을 계산합니다. 동일한 viewport에서는 이전 metrics 객체를 재사용하며,
 * viewport가 변경되면 cache miss로 새 metrics 객체를 계산합니다.
 * @param {number} ww - 화면 너비입니다.
 * @param {number} wh - 화면 높이입니다.
 * @returns {{ww: number, wh: number, titleFont: number, statsFont: number, titleFontString: string, statsFontString: string, statsX: number, statsY: number}}
 */
function createHudMetrics(ww, wh) {
    if (
        cachedHudMetrics
        && Object.is(cachedHudMetrics.ww, ww)
        && Object.is(cachedHudMetrics.wh, wh)
    ) {
        return cachedHudMetrics;
    }

    const titleFont = Math.max(14, ww * 0.0105);
    const statsFont = Math.max(10, ww * 0.0075);

    cachedHudMetrics = {
        ww,
        wh,
        titleFont,
        statsFont,
        titleFontString: createFontString({
            weight: 500,
            sizePx: titleFont,
            family: 'Pretendard Variable'
        }),
        statsFontString: createFontString({
            weight: 400,
            sizePx: statsFont,
            family: 'Pretendard Variable'
        }),
        statsX: ww * 0.985,
        statsY: wh * 0.96
    };

    return cachedHudMetrics;
}

/**
 * 일반 스냅샷 기반 HUD를 렌더합니다.
 * @param {{sceneSnapshot?: object|null, collisionStats?: object|null, objectSystem?: object|null, ww?: number, wh?: number}} [options={}] - HUD 렌더 옵션입니다.
 * @returns {void}
 */
export function drawGameSceneHud(options = {}) {
    const sceneSnapshot = options?.sceneSnapshot ?? null;
    const metrics = createHudMetrics(options?.ww ?? 0, options?.wh ?? 0);
    const collisionStats = sceneSnapshot?.collisionStats ?? options?.collisionStats;
    const enemyCount = resolveHudEnemyCount(sceneSnapshot, options?.objectSystem ?? null);

    renderHudTitle(metrics);
    renderHudEnemyCount(metrics, enemyCount);
    renderHudCollisionStats(metrics, collisionStats);
}
