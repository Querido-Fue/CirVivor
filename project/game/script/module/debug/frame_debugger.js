import { ColorSchemes } from 'display/theme_handler.js';
import { getWW, getWH, render } from 'display/_display_system.js';
import { getDebugData } from 'game/time_handler.js';
import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { getMouseInput } from 'input/_input_system.js';

export class FrameDebugger {
    constructor() {
        this.WW = getWW();
        this.WH = getWH();
        this.historySize = 300; // 약 5초간의 기록 (60fps 기준)
        this.history = {
            fps: [],
            fixedFps: [],
            frametime: [],
            fixedFrametime: [],
            code: [],
            update: [],
            draw: [],
            system: []
        };
        this.showGraph = false;
    }

    /**
     * 프레임 디버거 업데이트
     * 프레임 변화량을 history에 누적합니다.
     */
    update() {
        // 가운데 마우스 버튼 클릭 감지 및 그래프 표시 토글
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

        // 정해진 크기를 초과하면 오래된 데이터 제거
        if (this.history.fps.length > this.historySize) {
            this.history.fps.shift();
            this.history.fixedFps.shift();
            this.history.frametime.shift();
            this.history.fixedFrametime.shift();
            this.history.code.shift();
            this.history.update.shift();
            this.history.draw.shift();
            this.history.system.shift();
        }
    }

    /**
     * 개별 그래프를 꺾은선으로 그립니다.
     */
    drawGraph(label, valueStr, data, x, y, width, height, font, color) {
        if (this.showGraph) {
            // 배경 박스 (반투명)
            render('top', {
                shape: 'rect', x: x, y: y, w: width, h: height,
                fill: '#000000', alpha: 0.2
            });
        }

        // 텍스트 출력 (항상 보임)
        render('top', {
            shape: 'text', text: `${label}: ${valueStr}`,
            x: x + width * 0.02, y: y + height * 0.5,
            font: font, fill: color, align: 'left', baseline: 'middle'
        });

        if (!this.showGraph) return;

        // 이하 그래프 그리기 영역 (우측 55%)
        const graphWidth = width * 0.55;
        const graphX = x + width - graphWidth - width * 0.02;

        const dataLen = data.length;
        if (dataLen < 1) return;

        let maxVal = Math.max(...data);
        let minVal = Math.min(...data);

        // 여유폭 설정 (범위의 3배 정도 여백을 주어 그래프가 상하로 압축되도록 설정)
        let range = maxVal - minVal;
        if (range === 0) {
            maxVal += 3;
            minVal = Math.max(0, minVal - 3);
        } else {
            maxVal += range * 1.0;
            minVal -= range * 1.0;
            if (minVal < 0) minVal = 0;
        }

        // Y축 라벨
        const labelFont = `100 16px 'Pretendard Variable'`;

        // y축 라벨 오른쪽 맞춤 (그래프 바로 왼쪽)
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

        // 그래프 꺾은선 그리기 (오른쪽에서 흐르는 형태)
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

        // 버전 정보는 우측 하단에 유지
        render('top', {
            shape: 'text', text: "ver " + GLOBAL_CONSTANTS.GAME_VERSION,
            x: WW * 0.995, y: debugY,
            font: font, fill: color, align: 'right', baseline: 'middle'
        });

        // 좌측 상단 6개 그래프 
        const graphW = WW * 0.22; // 넓이 조절 (라벨 공간 확보)
        const graphH = WH * 0.035; // 높이 조절
        const startX = WW * 0.001; // 위치 변경 (기존 0.005 -> 0.001) 더 왼쪽으로 이동
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