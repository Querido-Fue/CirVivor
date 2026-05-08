import { ColorSchemes } from 'display/_theme_handler.js';
import { render } from 'display/display_system.js';
import { measurePerformanceSection } from 'debug/debug_system.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';
import { buildGameSceneSimulationWorkerHudLines } from '../game_scene_worker_hud.js';

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
 * @param {{ww: number, wh: number, titleFont: number}} metrics - HUD 배치 값입니다.
 */
function renderHudTitle(metrics) {
    render('ui', {
        shape: 'text',
        text: 'Benchmark Scene',
        x: metrics.ww * 0.03,
        y: metrics.wh * 0.04,
        font: `500 ${metrics.titleFont}px "Pretendard Variable"`,
        fill: ColorSchemes.Game.Font,
        align: 'left',
        baseline: 'middle'
    });
}

/**
 * 적 수 텍스트를 렌더합니다.
 * @param {{statsX: number, statsY: number, statsFont: number}} metrics - HUD 배치 값입니다.
 * @param {number} enemyCount - 표시할 적 수입니다.
 */
function renderHudEnemyCount(metrics, enemyCount) {
    render('ui', {
        shape: 'text',
        text: `enemy count: ${enemyCount}`,
        x: metrics.statsX,
        y: metrics.statsY,
        font: `400 ${metrics.statsFont}px "Pretendard Variable"`,
        fill: ColorSchemes.Game.Font,
        align: 'right',
        baseline: 'bottom',
        alpha: 0.9
    });
}

/**
 * 시뮬레이션 워커 상태 줄을 렌더합니다.
 * @param {{statsX: number, statsY: number, statsFont: number}} metrics - HUD 배치 값입니다.
 * @param {string[]} simulationWorkerHudLines - 표시할 상태 줄입니다.
 */
function renderHudWorkerLines(metrics, simulationWorkerHudLines) {
    for (let i = 0; i < simulationWorkerHudLines.length; i++) {
        const reverseIndex = simulationWorkerHudLines.length - 1 - i;
        render('ui', {
            shape: 'text',
            text: simulationWorkerHudLines[i],
            x: metrics.statsX,
            y: metrics.statsY - (metrics.statsFont * (6.4 + (reverseIndex * 1.28))),
            font: `400 ${metrics.statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
    }
}

/**
 * 충돌 통계 텍스트를 렌더합니다.
 * @param {{statsX: number, statsY: number, statsFont: number}} metrics - HUD 배치 값입니다.
 * @param {object|null|undefined} collisionStats - 충돌 통계입니다.
 */
function renderHudCollisionStats(metrics, collisionStats) {
    render('ui', {
        shape: 'text',
        text: `Collision check count: ${normalizeSnapshotNumber(collisionStats?.collisionCheckCount, 0)}`,
        x: metrics.statsX,
        y: metrics.statsY - (metrics.statsFont * 5.12),
        font: `400 ${metrics.statsFont}px "Pretendard Variable"`,
        fill: ColorSchemes.Game.Font,
        align: 'right',
        baseline: 'bottom',
        alpha: 0.9
    });
    render('ui', {
        shape: 'text',
        text: `AABB pass: ${normalizeSnapshotNumber(collisionStats?.aabbPassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.aabbRejectCount, 0)}`,
        x: metrics.statsX,
        y: metrics.statsY - (metrics.statsFont * 3.84),
        font: `400 ${metrics.statsFont}px "Pretendard Variable"`,
        fill: ColorSchemes.Game.Font,
        align: 'right',
        baseline: 'bottom',
        alpha: 0.9
    });
    render('ui', {
        shape: 'text',
        text: `Circle pass: ${normalizeSnapshotNumber(collisionStats?.circlePassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.circleRejectCount, 0)}`,
        x: metrics.statsX,
        y: metrics.statsY - (metrics.statsFont * 2.56),
        font: `400 ${metrics.statsFont}px "Pretendard Variable"`,
        fill: ColorSchemes.Game.Font,
        align: 'right',
        baseline: 'bottom',
        alpha: 0.9
    });
    render('ui', {
        shape: 'text',
        text: `Part check: ${normalizeSnapshotNumber(collisionStats?.partChecks, 0)}`,
        x: metrics.statsX,
        y: metrics.statsY - (metrics.statsFont * 1.28),
        font: `400 ${metrics.statsFont}px "Pretendard Variable"`,
        fill: ColorSchemes.Game.Font,
        align: 'right',
        baseline: 'bottom',
        alpha: 0.9
    });
}

/**
 * HUD 배치 값을 계산합니다.
 * @param {number} ww - 화면 너비입니다.
 * @param {number} wh - 화면 높이입니다.
 * @returns {{ww: number, wh: number, titleFont: number, statsFont: number, statsX: number, statsY: number}}
 */
function createHudMetrics(ww, wh) {
    return {
        ww,
        wh,
        titleFont: Math.max(14, ww * 0.0105),
        statsFont: Math.max(10, ww * 0.0075),
        statsX: ww * 0.985,
        statsY: wh * 0.96
    };
}

/**
 * 일반 스냅샷 기반 HUD를 렌더합니다.
 * @param {{sceneSnapshot?: object|null, collisionStats?: object|null, objectSystem?: object|null, systemHandler?: object|null, ww?: number, wh?: number}} [options={}] - HUD 렌더 옵션입니다.
 */
export function drawGameSceneHud(options = {}) {
    const sceneSnapshot = options?.sceneSnapshot ?? null;
    const metrics = createHudMetrics(options?.ww ?? 0, options?.wh ?? 0);
    const collisionStats = sceneSnapshot?.collisionStats ?? options?.collisionStats;
    const enemyCount = resolveHudEnemyCount(sceneSnapshot, options?.objectSystem ?? null);
    const simulationWorkerHudLines = buildGameSceneSimulationWorkerHudLines(options?.systemHandler ?? null);

    renderHudTitle(metrics);
    renderHudEnemyCount(metrics, enemyCount);
    renderHudWorkerLines(metrics, simulationWorkerHudLines);
    renderHudCollisionStats(metrics, collisionStats);
}

/**
 * 공유 프레젠테이션 기반 HUD를 렌더합니다.
 * @param {object|null|undefined} sharedState - 공유 프레젠테이션 읽기 상태입니다.
 * @param {{collisionStats?: object|null, systemHandler?: object|null, ww?: number, wh?: number}} [options={}] - HUD 렌더 옵션입니다.
 */
export function drawGameSceneSharedHud(sharedState, options = {}) {
    const metrics = createHudMetrics(options?.ww ?? 0, options?.wh ?? 0);
    const simulationWorkerHudLines = buildGameSceneSimulationWorkerHudLines(options?.systemHandler ?? null);
    const collisionStats = sharedState?.collisionStats ?? options?.collisionStats;
    const enemyCount = Math.max(0, Math.floor(sharedState?.enemyCount ?? 0));

    measurePerformanceSection('scene.game.shared.hud.title', () => {
        renderHudTitle(metrics);
    });

    measurePerformanceSection('scene.game.shared.hud.enemyCount', () => {
        renderHudEnemyCount(metrics, enemyCount);
    });

    measurePerformanceSection('scene.game.shared.hud.workerLines', () => {
        renderHudWorkerLines(metrics, simulationWorkerHudLines);
    });

    measurePerformanceSection('scene.game.shared.hud.collisionStats', () => {
        renderHudCollisionStats(metrics, collisionStats);
    });
}
