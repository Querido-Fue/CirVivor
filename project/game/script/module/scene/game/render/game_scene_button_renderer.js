import { getData } from 'data/data_handler.js';
import { render } from 'display/display_system.js';
import { getSimulationMouseInput } from 'simulation/simulation_runtime.js';
import { isPointInRect } from 'util/geometry_util.js';
import { createFontString } from 'util/font_util.js';
import { clamp01 } from 'util/number_util.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

const GAME_SCENE_BUTTON_CONSTANTS = getData('GAME_SCENE_CONSTANTS').BUTTON;
const BUTTON_RADIUS = GAME_SCENE_BUTTON_CONSTANTS.RADIUS;

/**
 * 벤치마크 씬 버튼 목록을 렌더합니다.
 * @param {object[]} [buttons=[]] - 렌더할 버튼 목록입니다.
 * @param {{ww?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneButtons(buttons = [], options = {}) {
    const buttonList = Array.isArray(buttons) ? buttons : [];
    const mousePos = getSimulationMouseInput('pos');
    const fontSize = Math.max(
        GAME_SCENE_BUTTON_CONSTANTS.FONT_MIN_SIZE,
        (Number.isFinite(options?.ww) ? options.ww : 0) * GAME_SCENE_BUTTON_CONSTANTS.FONT_WW_RATIO
    );
    const font = createFontString({
        weight: 500,
        sizePx: fontSize,
        family: 'Pretendard Variable'
    });

    for (let i = 0; i < buttonList.length; i++) {
        const button = buttonList[i];
        if (!button) continue;
        const hovering = mousePos ? isPointInRect(mousePos.x, mousePos.y, button) : false;
        const hoverBlend = clamp01(hovering ? 1 : 0);

        render('ui', {
            shape: 'roundRect',
            x: button.x,
            y: button.y,
            w: button.w,
            h: button.h,
            radius: BUTTON_RADIUS,
            fill: hoverBlend > 0 ? getBenchmarkColor('ButtonHover') : getBenchmarkColor('ButtonIdle')
        });
        render('ui', {
            shape: 'roundRect',
            x: button.x,
            y: button.y,
            w: button.w,
            h: button.h,
            radius: BUTTON_RADIUS,
            fill: false,
            stroke: getBenchmarkColor('ButtonStroke'),
            lineWidth: GAME_SCENE_BUTTON_CONSTANTS.BORDER_LINE_WIDTH
        });
        render('ui', {
            shape: 'text',
            text: button.label,
            x: button.x + (button.w * GAME_SCENE_BUTTON_CONSTANTS.TEXT_X_RATIO),
            y: button.y + (button.h * GAME_SCENE_BUTTON_CONSTANTS.TEXT_Y_RATIO),
            font,
            fill: getBenchmarkColor('ButtonText'),
            align: 'center',
            baseline: 'middle'
        });
    }
}
