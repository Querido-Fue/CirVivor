import { ColorSchemes } from '../display/theme_handler.js';
import { getWW, getWH, render } from '../display/_display_system.js';
import { getDebugData } from '../../time_handler.js';
import { GLOBAL_CONSTANTS } from '../../data/global/global_constants.js';

export class FrameDebugger {
    constructor() {
        this.WW = getWW();
        this.WH = getWH();
    }

    /**
     * 프레임 디버거 업데이트 (현재는 로직 없음)
     */
    update() {
    }

    /**
     * 프레임 정보를 화면에 그립니다.
     */
    draw() {
        const WW = getWW();
        const WH = getWH();
        const debugY = WH * 0.988;
        const fontSize = WW * 0.008;
        const font = `300 ${fontSize}px 'Pretendard Variable'`;
        const color = ColorSchemes.Debug.Fill;

        render('top', {
            shape: 'text', text: "ver " + GLOBAL_CONSTANTS.GAME_VERSION,
            x: WW * 0.995, y: debugY,
            font: font, fill: color, align: 'right', baseline: 'middle'
        });

        render('top', {
            shape: 'text', text: "fps: " + getDebugData('fps'),
            x: WW * 0.005, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        render('top', {
            shape: 'text', text: "low: " + getDebugData('lowestFps'),
            x: WW * 0.06, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        render('top', {
            shape: 'text', text: "frametime: " + (getDebugData('rawFrameTimeDelta') * 1000).toFixed(1),
            x: WW * 0.12, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        render('top', {
            shape: 'text', text: "update: " + getDebugData('lastUpdateTime').toFixed(1),
            x: WW * 0.31, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        render('top', {
            shape: 'text', text: "draw: " + getDebugData('lastDrawTime').toFixed(1),
            x: WW * 0.37, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        const rawFrametime = getDebugData('rawFrameTimeDelta') * 1000;
        const cycleTime = getDebugData('displayLastFrameTimeDelta');
        const systemTime = Math.max(0, rawFrametime - cycleTime);

        render('top', {
            shape: 'text', text: "system: " + systemTime.toFixed(1),
            x: WW * 0.43, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        render('top', {
            shape: 'text', text: "code: " + getDebugData('displayLastFrameTimeDelta').toFixed(1),
            x: WW * 0.25, y: debugY,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });
    }
}