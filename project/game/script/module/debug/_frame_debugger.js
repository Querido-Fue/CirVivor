import { ColorSchemes } from 'display/_theme_handler.js';
import { getWW, getWH, render } from 'display/display_system.js';
import { getDebugData } from 'game/time_handler.js';
import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { getMouseInput } from 'input/input_system.js';

/**
 * @class CircularBuffer
 * @description 고정 크기의 원형 버퍼입니다. shift() 없이 O(1)로 가장 오래된 항목을 교체합니다.
 * @template T
 */
class CircularBuffer {
    /**
     * @param {number} size - 버퍼 최대 크기
     */
    constructor(size) {
        this._buf = new Array(size).fill(0);
        this._size = size;
        this._head = 0;
        this._count = 0;
    }

    /**
     * 새 값을 추가합니다. 버퍼가 가득 찼으면 가장 오래된 값을 덮어씁니다.
     * @param {T} value
     */
    push(value) {
        this._buf[this._head] = value;
        this._head = (this._head + 1) % this._size;
        if (this._count < this._size) this._count++;
    }

    /**
     * 오래된 순서로 정렬된 배열을 반환합니다. (그래프 그리기용)
     * @returns {T[]}
     */
    toArray() {
        if (this._count < this._size) {
            return this._buf.slice(0, this._count);
        }
        return [...this._buf.slice(this._head), ...this._buf.slice(0, this._head)];
    }

    /**
     * 마지막으로 추가된 값을 반환합니다.
     * @returns {T}
     */
    last() {
        const idx = (this._head - 1 + this._size) % this._size;
        return this._buf[idx];
    }

    /** @returns {number} 현재 저장된 항목 수 */
    get length() { return this._count; }
}

/**
 * @class FrameDebugger
 * @description FPS/프레임타임/코드 시간 이력을 수집하고 디버그 그래프로 렌더링합니다.
 */
export class FrameDebugger {
    /**
     * 프레임 디버거를 초기화하고 프레임 이력을 저장할 버퍼를 생성합니다.
     */
    constructor() {
        this.WW = getWW();
        this.WH = getWH();
        this.historySize = 300;
        this.history = {
            fps: new CircularBuffer(this.historySize),
            fixedFps: new CircularBuffer(this.historySize),
            frametime: new CircularBuffer(this.historySize),
            fixedFrametime: new CircularBuffer(this.historySize),
            code: new CircularBuffer(this.historySize),
            update: new CircularBuffer(this.historySize),
            draw: new CircularBuffer(this.historySize),
            system: new CircularBuffer(this.historySize)
        };
        this.showGraph = false;
    }

    /**
     * 프레임 디버거 업데이트
     * 프레임 변화량을 history에 누적합니다.
     */
    update() {
        const middleClicked = getMouseInput?.('middleClicked');
        if (middleClicked) {
            this.showGraph = !this.showGraph;
        }

        const avgUpdateTime = getDebugData('avgUpdateTime');
        const avgDrawTime = getDebugData('avgDrawTime');
        const avgFrameTimeMs = getDebugData('avgFrameTime') * 1000;
        const avgCodeTime = avgUpdateTime + avgDrawTime;
        const systemTime = Math.max(0, avgFrameTimeMs - avgCodeTime);
        const fps = getDebugData('fps');
        const fixedFps = getDebugData('currentFixedFps');
        const fixedFrametime = getDebugData('lastFixedTimeDelta') * 1000;

        this.history.fps.push(fps);
        this.history.fixedFps.push(fixedFps);
        this.history.frametime.push(avgFrameTimeMs);
        this.history.fixedFrametime.push(fixedFrametime);
        this.history.code.push(avgCodeTime);
        this.history.update.push(avgUpdateTime);
        this.history.draw.push(avgDrawTime);
        this.history.system.push(systemTime);
    }

    /**
     * 개별 그래프를 꺾은선으로 그립니다.
     */
    drawGraph(label, valueStr, buffer, x, y, width, height, font, color) {
        if (this.showGraph) {
            render('top', {
                shape: 'rect', x: x, y: y, w: width, h: height,
                fill: '#000000', alpha: 0.2
            });
        }

        render('top', {
            shape: 'text', text: `${label}: ${valueStr}`,
            x: x + width * 0.02, y: y + height * 0.5,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        if (!this.showGraph) return;

        const graphWidth = width * 0.55;
        const graphX = x + width - graphWidth - width * 0.02;

        const data = buffer.toArray();
        const dataLen = data.length;
        if (dataLen < 1) return;

        let maxVal = Math.max(...data);
        let minVal = Math.min(...data);

        let range = maxVal - minVal;
        if (range === 0) {
            maxVal += 3;
            minVal = Math.max(0, minVal - 3);
        } else {
            maxVal += range * 1.0;
            minVal -= range * 1.0;
            if (minVal < 0) minVal = 0;
        }

        const labelFont = `100 16px 'Pretendard Variable'`;

        render('top', {
            shape: 'text', text: maxVal.toFixed(1),
            x: graphX - width * 0.01, y: y + height * 0.15,
            font: labelFont, fill: color, align: 'right', baseline: 'middle', alpha: 0.7
        });
        render('top', {
            shape: 'text', text: minVal.toFixed(1),
            x: graphX - width * 0.01, y: y + height * 0.85,
            font: labelFont, fill: color, align: 'right', baseline: 'middle', alpha: 0.7
        });

        if (dataLen < 2) return;

        const pointGap = graphWidth / Math.max(1, this.historySize - 1);

        for (let i = 1; i < dataLen; i++) {
            const val1 = data[i - 1];
            const val2 = data[i];

            const h1 = (val1 - minVal) / (maxVal - minVal) * (height * 0.8);
            const h2 = (val2 - minVal) / (maxVal - minVal) * (height * 0.8);

            const bx1 = graphX + graphWidth - (dataLen - i) * pointGap;
            const by1 = y + height * 0.9 - h1;
            const bx2 = graphX + graphWidth - (dataLen - 1 - i) * pointGap;
            const by2 = y + height * 0.9 - h2;

            render('top', {
                shape: 'line', x1: bx1, y1: by1, x2: bx2, y2: by2,
                stroke: color, alpha: 0.8, lineWidth: 1.5
            });
        }
    }

    /**
     * 프레임 정보를 화면에 그립니다.
     */
    draw() {
        const WW = getWW();
        const WH = getWH();
        const debugY = WH * 0.988;
        const fontSize = Math.max(10, WW * 0.008);
        const font = `200 ${fontSize}px 'Pretendard Variable'`;
        const color = ColorSchemes.Debug.Fill;

        const fps = getDebugData('fps');
        const fixedFps = getDebugData('currentFixedFps');
        const fixedFrametimeStr = (getDebugData('lastFixedTimeDelta') * 1000).toFixed(1);
        const avgUpdateTime = getDebugData('avgUpdateTime');
        const avgDrawTime = getDebugData('avgDrawTime');
        const avgFrameTimeMs = getDebugData('avgFrameTime') * 1000;
        const avgCodeTime = avgUpdateTime + avgDrawTime;
        const systemTime = Math.max(0, avgFrameTimeMs - avgCodeTime);

        render('top', {
            shape: 'text', text: "ver " + GLOBAL_CONSTANTS.GAME_VERSION,
            x: WW * 0.995, y: debugY,
            font: font, fill: color, align: 'right', baseline: 'middle'
        });

        const graphW = WW * 0.22;
        const graphH = WH * 0.035;
        const startX = WW * 0.001;
        let currentY = WH * 0.005;
        const gapY = graphH + WH * 0.008;

        this.drawGraph("FPS", `${fps} (low: ${getDebugData('lowestFps')})`, this.history.fps, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("FrameTime", avgFrameTimeMs.toFixed(1), this.history.frametime, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("Code", avgCodeTime.toFixed(1), this.history.code, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("Update", avgUpdateTime.toFixed(1), this.history.update, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("Draw", avgDrawTime.toFixed(1), this.history.draw, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("System", systemTime.toFixed(1), this.history.system, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("FixedFPS", `${fixedFps}`, this.history.fixedFps, startX, currentY, graphW, graphH, font, color);
        currentY += gapY;
        this.drawGraph("F.FrameTime", fixedFrametimeStr, this.history.fixedFrametime, startX, currentY, graphW, graphH, font, color);
    }
}
