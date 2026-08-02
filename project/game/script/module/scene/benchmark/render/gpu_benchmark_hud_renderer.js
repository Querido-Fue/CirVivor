import { ColorSchemes } from 'display/_theme_handler.js';
import { render } from 'display/display_system.js';
import { createFontString } from 'util/font_util.js';

const PROFILE_LABELS = Object.freeze({
    'strict-interpolation': 'Strict (Interpolation)',
    'reference-clock-extrapolation': 'Reference (Original)',
    'capped-accumulator-extrapolation': 'Capped (Safe Extrapolation)'
});
const TITLE_OPTIONS = {
    shape: 'text',
    text: '',
    x: 0,
    y: 0,
    font: '',
    fill: '',
    align: 'left',
    baseline: 'middle'
};
const STATUS_OPTIONS = {
    shape: 'text',
    text: '',
    x: 0,
    y: 0,
    font: '',
    fill: '',
    align: 'right',
    baseline: 'bottom',
    alpha: 0.92
};
let cachedMetrics = null;

function normalizeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function normalizeFinite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function resolveMetrics(ww, wh) {
    if (cachedMetrics
        && Object.is(cachedMetrics.ww, ww)
        && Object.is(cachedMetrics.wh, wh)) {
        return cachedMetrics;
    }
    const titleFontSize = ww * 0.0105;
    const statusFontSize = ww * 0.0075;
    cachedMetrics = {
        ww,
        wh,
        titleX: ww * 0.03,
        titleY: wh * 0.04,
        statusX: ww * 0.985,
        statusY: wh * 0.96,
        statusStride: statusFontSize * 1.28,
        titleFont: createFontString({ weight: 500, sizePx: titleFontSize }),
        statusFont: createFontString({ weight: 400, sizePx: statusFontSize })
    };
    return cachedMetrics;
}

function drawStatusLine(metrics, text, row) {
    STATUS_OPTIONS.text = text;
    STATUS_OPTIONS.x = metrics.statusX;
    STATUS_OPTIONS.y = metrics.statusY - (metrics.statusStride * row);
    STATUS_OPTIONS.font = metrics.statusFont;
    STATUS_OPTIONS.fill = ColorSchemes.Game.Font;
    render('ui', STATUS_OPTIONS);
}

/**
 * production GPU mixed-body benchmark visual-QA 상태를 HUD에 표시합니다.
 * @param {object} status - BenchmarkScene이 만든 immutable 상태 snapshot입니다.
 * @param {{ww?:number,wh?:number}} [viewport={}] - 현재 표시 viewport입니다.
 * @returns {void}
 */
export function drawGpuBenchmarkHud(status, viewport = {}) {
    const metrics = resolveMetrics(
        Number.isFinite(viewport.ww) ? viewport.ww : 0,
        Number.isFinite(viewport.wh) ? viewport.wh : 0
    );
    const profile = status?.presentationProfile ?? 'unknown';
    TITLE_OPTIONS.text = `Benchmark Scene · GPU Mixed Bodies · ${PROFILE_LABELS[profile] ?? profile}`;
    TITLE_OPTIONS.x = metrics.titleX;
    TITLE_OPTIONS.y = metrics.titleY;
    TITLE_OPTIONS.font = metrics.titleFont;
    TITLE_OPTIONS.fill = ColorSchemes.Game.Font;
    render('ui', TITLE_OPTIONS);

    const activeCount = normalizeCount(status?.activeCount);
    const reservedCount = normalizeCount(status?.reservedCount);
    const pendingCount = normalizeCount(status?.pendingCommandCount);
    const overflowSmall = normalizeCount(status?.overflowSmallCount);
    const overflowBig = normalizeCount(status?.overflowBigCount);
    drawStatusLine(
        metrics,
        `GPU: ${String(status?.backendState ?? 'unavailable')} | platform: ${String(status?.platformStatus ?? 'unknown')}`,
        0
    );
    drawStatusLine(
        metrics,
        `GPU active: ${normalizeCount(status?.enemyActiveCount)} enemy + ${normalizeCount(status?.projectileActiveCount)} projectile + ${normalizeCount(status?.playerProxyActiveCount)} player proxy = ${activeCount} backend bodies`,
        1
    );
    drawStatusLine(
        metrics,
        `queue: ${reservedCount} reserved + ${pendingCount} pending | queued enemy/projectile: ${normalizeCount(status?.totalQueuedEnemySpawnCount)}/${normalizeCount(status?.totalQueuedProjectileSpawnCount)}`,
        2
    );
    drawStatusLine(
        metrics,
        `last batch: enemy ${String(status?.lastEnemySpawnBatchReason ?? 'not-requested')} | projectile ${String(status?.lastProjectileSpawnBatchReason ?? 'not-requested')} | proxy ${String(status?.lastPlayerProxyReason ?? 'not-requested')}`,
        3
    );
    drawStatusLine(
        metrics,
        `GPU events: ${normalizeCount(status?.gpuContactCount)} contact | ${normalizeCount(status?.gpuAppliedEventCount)} applied | ${normalizeCount(status?.gpuDeathEventCount)} death`,
        4
    );
    drawStatusLine(
        metrics,
        `event overflow C/A/D: ${normalizeCount(status?.gpuContactOverflowCount)}/${normalizeCount(status?.gpuAppliedEventOverflowCount)}/${normalizeCount(status?.gpuDeathEventOverflowCount)} | watermark ${normalizeCount(status?.gpuEventSubmittedTickWatermark)}→${normalizeCount(status?.gpuEventCompletedTickWatermark)}`,
        5
    );
    drawStatusLine(
        metrics,
        `fixed tick: ${normalizeCount(status?.fixedTick)} | grid overflow: ${overflowSmall}/${overflowBig}`,
        6
    );
    drawStatusLine(
        metrics,
        `presentation: predict ${(normalizeFinite(status?.predictionDelta) * 1000).toFixed(2)} ms | alpha ${normalizeFinite(status?.interpolationAlpha).toFixed(3)}`,
        7
    );
    drawStatusLine(
        metrics,
        `CPU collision: ${normalizeCount(status?.cpuCollisionCheckCount)} checks | part: ${normalizeCount(status?.cpuPartChecks)}`,
        8
    );
    drawStatusLine(
        metrics,
        `CPU AABB: ${normalizeCount(status?.cpuAabbPassCount)} pass / ${normalizeCount(status?.cpuAabbRejectCount)} reject`,
        9
    );
    drawStatusLine(
        metrics,
        `CPU circle: ${normalizeCount(status?.cpuCirclePassCount)} pass / ${normalizeCount(status?.cpuCircleRejectCount)} reject`,
        10
    );
    drawStatusLine(
        metrics,
        `CPU tools: ${normalizeCount(status?.cpuProjectileCount)} projectiles + ${normalizeCount(status?.boxCount)} boxes`,
        11
    );
    drawStatusLine(
        metrics,
        'arena walls/initial boxes use GPU SDF; blue player uses a hidden GPU proxy; Spawn Box is CPU-only',
        12
    );
    drawStatusLine(
        metrics,
        `recovery: ${status?.recoveryRequired === true ? 'required' : 'ok'} | session: ${normalizeCount(status?.sessionGeneration)} | restart: ${normalizeCount(status?.restartCount)}`,
        13
    );
}
