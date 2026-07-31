import { getWH, getWW, render } from 'display/display_system.js';
import { getReleaseSimulationProfilerSnapshot } from 'simulation/release_simulation_profiler.js';
import {
    RELEASE_SIMULATION_PROFILER_CONSTANTS
} from 'simulation/release_simulation_profiler_constants.js';
import { createFontString } from 'util/font_util.js';

const HUD_CONSTANTS = RELEASE_SIMULATION_PROFILER_CONSTANTS.HUD;
const HUD_LINE_COUNT = 4;
const hudLines = new Array(HUD_LINE_COUNT).fill('');
const textCommands = Array.from({ length: HUD_LINE_COUNT }, () => ({
    shape: 'text',
    text: '',
    x: 0,
    y: 0,
    font: '',
    fill: HUD_CONSTANTS.TEXT_FILL,
    align: 'right',
    baseline: 'top'
}));
const panelCommand = {
    shape: 'roundRect',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    radius: 0,
    fill: HUD_CONSTANTS.PANEL_FILL
};
let cachedRevision = -1;
let cachedWidth = -1;
let cachedHeight = -1;

/**
 * 벤치마크 전용 릴리스 시뮬레이션 지표를 top 레이어에 렌더합니다.
 * overlay 뒤에 호출되므로 실시간 blur의 backdrop 입력을 변경하지 않습니다.
 * @returns {void}
 */
export function drawReleaseSimulationProfilerHud() {
    const snapshot = getReleaseSimulationProfilerSnapshot();
    if (snapshot?.enabled !== true || snapshot?.active !== true || snapshot?.revision <= 0) {
        return;
    }

    const ww = getWW();
    const wh = getWH();
    if (snapshot.revision !== cachedRevision || ww !== cachedWidth || wh !== cachedHeight) {
        updateHudCommands(snapshot, ww, wh);
    }

    render('top', panelCommand);
    for (let i = 0; i < textCommands.length; i++) {
        render('top', textCommands[i]);
    }
}

/**
 * HUD 문자열과 재사용 렌더 command를 최신 snapshot에 맞게 갱신합니다.
 * @param {object} snapshot - 릴리스 계측 스냅샷입니다.
 * @param {number} ww - 표시 너비입니다.
 * @param {number} wh - 표시 높이입니다.
 * @returns {void}
 */
function updateHudCommands(snapshot, ww, wh) {
    const fontSize = Math.max(HUD_CONSTANTS.FONT_MIN_SIZE, ww * HUD_CONSTANTS.FONT_WW_RATIO);
    const lineHeight = fontSize * HUD_CONSTANTS.LINE_HEIGHT_RATIO;
    const padding = fontSize * HUD_CONSTANTS.PANEL_PADDING_RATIO;
    const x = ww * HUD_CONSTANTS.X_WW_RATIO;
    const y = wh * HUD_CONSTANTS.Y_WH_RATIO;
    const font = createFontString({
        weight: HUD_CONSTANTS.FONT_WEIGHT,
        sizePx: fontSize
    });

    hudLines[0] = `FPS ${format1(snapshot.frameRate)} | FIXED ${format1(snapshot.actualFixedTicksPerSecond)}/s | SIM ${format1(snapshot.simulationProgressRatio * 100)}%`;
    hudLines[1] = `Frame ms p50/p95/p99 ${formatTriple(snapshot, 'frameInterval')}`;
    hudLines[2] = `CPU ms frame ${formatTriple(snapshot, 'frameCpu')} | fixed ${formatTriple(snapshot, 'fixedCpu')}`;
    hudLines[3] = `Debt ${format1(snapshot.droppedFixedStepsPerSecond)}/s total ${snapshot.totalDroppedFixedStepCount} | lost ${format3(snapshot.totalLostSimulationSeconds)}s | bound ${format1(snapshot.cpuBoundFramePercent)}%`;

    let longestLineLength = 0;
    for (let i = 0; i < hudLines.length; i++) {
        const command = textCommands[i];
        command.text = hudLines[i];
        command.x = x;
        command.y = y + (lineHeight * i);
        command.font = font;
        longestLineLength = Math.max(longestLineLength, hudLines[i].length);
    }

    const panelWidth = (fontSize * HUD_CONSTANTS.PANEL_CHAR_WIDTH_RATIO * longestLineLength) + (padding * 2);
    panelCommand.x = x - panelWidth + padding;
    panelCommand.y = y - padding;
    panelCommand.w = panelWidth;
    panelCommand.h = (lineHeight * hudLines.length) + (padding * 2);
    panelCommand.radius = padding;
    cachedRevision = snapshot.revision;
    cachedWidth = ww;
    cachedHeight = wh;
}

/**
 * 스냅샷의 p50/p95/p99 필드를 한 문자열로 변환합니다.
 * @param {object} snapshot - 계측 스냅샷입니다.
 * @param {string} prefix - 필드 접두사입니다.
 * @returns {string} 분위수 문자열입니다.
 */
function formatTriple(snapshot, prefix) {
    return `${format1(snapshot[`${prefix}P50Ms`])}/${format1(snapshot[`${prefix}P95Ms`])}/${format1(snapshot[`${prefix}P99Ms`])}`;
}

/**
 * 숫자를 소수점 한 자리 문자열로 변환합니다.
 * @param {number} value - 입력 값입니다.
 * @returns {string} 포맷된 값입니다.
 */
function format1(value) {
    return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

/**
 * 숫자를 소수점 세 자리 문자열로 변환합니다.
 * @param {number} value - 입력 값입니다.
 * @returns {string} 포맷된 값입니다.
 */
function format3(value) {
    return Number.isFinite(value) ? value.toFixed(3) : '0.000';
}
