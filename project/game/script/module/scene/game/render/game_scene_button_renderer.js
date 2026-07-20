import { getData } from 'data/data_handler.js';
import { render } from 'display/display_system.js';
import { copySimulationMousePositionInto } from 'simulation/simulation_runtime.js';
import { isPointInRect } from 'util/geometry_util.js';
import { createFontString } from 'util/font_util.js';
import { clamp01 } from 'util/number_util.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

const GAME_SCENE_BUTTON_CONSTANTS = getData('GAME_SCENE_CONSTANTS').BUTTON;
const BUTTON_RADIUS = GAME_SCENE_BUTTON_CONSTANTS.RADIUS;
const BUTTON_MOUSE_POSITION_SCRATCH = { x: 0, y: 0 };
const BUTTON_BACKGROUND_RENDER_OPTIONS = {
    shape: 'roundRect',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    radius: BUTTON_RADIUS,
    fill: ''
};
const BUTTON_BORDER_RENDER_OPTIONS = {
    shape: 'roundRect',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    radius: BUTTON_RADIUS,
    fill: false,
    stroke: '',
    lineWidth: GAME_SCENE_BUTTON_CONSTANTS.BORDER_LINE_WIDTH
};
const BUTTON_TEXT_RENDER_OPTIONS = {
    shape: 'text',
    text: '',
    x: 0,
    y: 0,
    font: '',
    fill: '',
    align: 'center',
    baseline: 'middle'
};
let cachedButtonFontSize;
let cachedButtonFont = '';

/**
 * 현재 버튼 글자 크기에 대응하는 font 문자열을 반환합니다.
 * @param {number} fontSize - 버튼 글자 크기입니다.
 * @returns {string} canvas font 문자열입니다.
 */
function getGameSceneButtonFont(fontSize) {
    if (!Object.is(cachedButtonFontSize, fontSize)) {
        cachedButtonFontSize = fontSize;
        cachedButtonFont = createFontString({
            weight: 500,
            sizePx: fontSize,
            family: 'Pretendard Variable'
        });
    }

    return cachedButtonFont;
}

/**
 * 벤치마크 씬 버튼 목록을 렌더합니다.
 * @param {object[]} [buttons=[]] - 렌더할 버튼 목록입니다.
 * @param {{ww?: number}} [options={}] - 렌더 옵션입니다.
 * @returns {void}
 */
export function drawGameSceneButtons(buttons = [], options = {}) {
    const buttonList = Array.isArray(buttons) ? buttons : [];
    const mousePos = copySimulationMousePositionInto(BUTTON_MOUSE_POSITION_SCRATCH);
    const fontSize = Math.max(
        GAME_SCENE_BUTTON_CONSTANTS.FONT_MIN_SIZE,
        (Number.isFinite(options?.ww) ? options.ww : 0) * GAME_SCENE_BUTTON_CONSTANTS.FONT_WW_RATIO
    );
    const font = getGameSceneButtonFont(fontSize);

    for (let i = 0; i < buttonList.length; i++) {
        const button = buttonList[i];
        if (!button) continue;
        const hovering = mousePos ? isPointInRect(mousePos.x, mousePos.y, button) : false;
        const hoverBlend = clamp01(hovering ? 1 : 0);

        const backgroundOptions = BUTTON_BACKGROUND_RENDER_OPTIONS;
        backgroundOptions.x = button.x;
        backgroundOptions.y = button.y;
        backgroundOptions.w = button.w;
        backgroundOptions.h = button.h;
        backgroundOptions.fill = hoverBlend > 0
            ? getBenchmarkColor('ButtonHover')
            : getBenchmarkColor('ButtonIdle');
        render('ui', backgroundOptions);

        const borderOptions = BUTTON_BORDER_RENDER_OPTIONS;
        borderOptions.x = button.x;
        borderOptions.y = button.y;
        borderOptions.w = button.w;
        borderOptions.h = button.h;
        borderOptions.stroke = getBenchmarkColor('ButtonStroke');
        render('ui', borderOptions);

        const textOptions = BUTTON_TEXT_RENDER_OPTIONS;
        textOptions.text = button.label;
        textOptions.x = button.x + (button.w * GAME_SCENE_BUTTON_CONSTANTS.TEXT_X_RATIO);
        textOptions.y = button.y + (button.h * GAME_SCENE_BUTTON_CONSTANTS.TEXT_Y_RATIO);
        textOptions.font = font;
        textOptions.fill = getBenchmarkColor('ButtonText');
        render('ui', textOptions);
    }
}
