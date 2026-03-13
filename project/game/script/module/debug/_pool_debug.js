import { getCanvasPoolStats, render, getWH } from "display/display_system.js";
import { activeObjectPools } from "object/_object_pool.js";

/**
 * @class PoolDebugger
 * @description 현재 사용 중인 오브젝트 풀과 캔버스 풀 현황을 화면 좌측 하단에 표시합니다.
 */
export class PoolDebugger {
    constructor() {
    }

    /**
     * 오브젝트 풀 디버거 상태를 업데이트합니다.
     */
    update() {
    }

    /**
     * 오브젝트 풀 디버그 정보를 화면에 그립니다.
     */
    draw() {
        const lines = this.#buildDebugLines();
        if (lines.length === 0) return;

        const ch = getWH();

        const fontSize = Math.max(12, Math.floor(ch * 0.015));
        const font = `600 ${fontSize}px "Pretendard Variable", arial`;
        const lineHeight = fontSize + Math.max(4, Math.floor(ch * 0.005));
        const startX = Math.max(10, Math.floor(ch * 0.01));
        const startY = ch - startX - (lines.length * lineHeight);

        // 배경 패널 그리기
        const panelPadding = Math.max(5, Math.floor(ch * 0.005));
        const panelWidth = fontSize * 26;
        const panelHeight = lines.length * lineHeight + panelPadding * 2;

        render('ui', {
            shape: 'roundRect',
            x: startX - panelPadding,
            y: startY - panelPadding,
            w: panelWidth,
            h: panelHeight,
            radius: panelPadding,
            fill: 'rgba(0, 0, 0, 0.7)'
        });

        for (let i = 0; i < lines.length; i++) {
            const textY = startY + i * lineHeight;

            render('ui', {
                shape: 'text',
                text: lines[i],
                x: startX,
                y: textY,
                font: font,
                fill: '#FFFFFF',
                align: 'left',
                baseline: 'top'
            });
        }
    }

    /**
     * 디버그 패널에 출력할 문자열 목록을 구성합니다.
     * @returns {string[]} 출력 문자열 목록입니다.
     * @private
     */
    #buildDebugLines() {
        const keys = Object.keys(activeObjectPools);
        const lines = keys.map((name) => {
            const poolObj = activeObjectPools[name];
            const availableCount = poolObj.pool !== undefined ? poolObj.pool.length : 0;
            const createdCount = poolObj.createdCount !== undefined ? poolObj.createdCount : availableCount;
            const inUseCount = createdCount - availableCount;
            return `${name}: ${inUseCount} / ${createdCount}`;
        });
        const canvasPoolStats = getCanvasPoolStats();

        lines.push(
            `CanvasPool2D: ${canvasPoolStats.twoD.activeCount} / ${canvasPoolStats.twoD.createdCount} (free ${canvasPoolStats.twoD.availableCount})`,
            `CanvasPoolGL: ${canvasPoolStats.webgl.activeCount} / ${canvasPoolStats.webgl.createdCount} (free ${canvasPoolStats.webgl.availableCount})`
        );

        return lines;
    }
}
