import { render } from 'display/display_system.js';
import { getSimulationMouseInput } from 'simulation/simulation_runtime.js';
import { getBenchmarkColor } from './game_scene_benchmark_palette.js';

const BUTTON_RADIUS = 10;

/**
 * 값을 0에서 1 사이로 제한합니다.
 * @param {number} value - 제한할 값입니다.
 * @returns {number} 제한된 값입니다.
 */
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

/**
 * 포인터가 사각형 내부에 있는지 확인합니다.
 * @param {number} x - 포인터 x 좌표입니다.
 * @param {number} y - 포인터 y 좌표입니다.
 * @param {{x: number, y: number, w: number, h: number}} rect - 검사할 사각형입니다.
 * @returns {boolean}
 */
function isPointInRect(x, y, rect) {
    return (
        x >= rect.x &&
        x <= rect.x + rect.w &&
        y >= rect.y &&
        y <= rect.y + rect.h
    );
}

/**
 * 벤치마크 씬 버튼 목록을 렌더합니다.
 * @param {object[]} [buttons=[]] - 렌더할 버튼 목록입니다.
 * @param {{ww?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneButtons(buttons = [], options = {}) {
    const buttonList = Array.isArray(buttons) ? buttons : [];
    const mousePos = getSimulationMouseInput('pos');
    const fontSize = Math.max(11, (Number.isFinite(options?.ww) ? options.ww : 0) * 0.0092);

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
            lineWidth: 1
        });
        render('ui', {
            shape: 'text',
            text: button.label,
            x: button.x + (button.w * 0.5),
            y: button.y + (button.h * 0.54),
            font: `500 ${fontSize}px "Pretendard Variable"`,
            fill: getBenchmarkColor('ButtonText'),
            align: 'center',
            baseline: 'middle'
        });
    }
}
