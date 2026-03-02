import { render, getWH } from "display/display_system.js";
import { activeObjectPools } from "util/_object_pool.js";
import { ColorSchemes } from "display/_theme_handler.js";

/**
 * @class PoolDebugger
 * @description 현재 사용 중인 오브젝트 풀의 현황(최대치 및 활성 개수)을 화면 좌측 하단에 표시합니다.
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
        const keys = Object.keys(activeObjectPools);
        if (keys.length === 0) return;

        const ch = getWH();

        const fontSize = Math.max(12, Math.floor(ch * 0.015));
        const font = `600 ${fontSize}px "Pretendard Variable", arial`;
        const lineHeight = fontSize + Math.max(4, Math.floor(ch * 0.005));
        const startX = Math.max(10, Math.floor(ch * 0.01));

        const startY = ch - startX - (keys.length * lineHeight);

        // 배경 패널 그리기
        const panelPadding = Math.max(5, Math.floor(ch * 0.005));
        const panelWidth = fontSize * 18;
        const panelHeight = keys.length * lineHeight + panelPadding * 2;

        render('ui', {
            shape: 'roundRect',
            x: startX - panelPadding,
            y: startY - panelPadding,
            w: panelWidth,
            h: panelHeight,
            radius: panelPadding,
            fill: 'rgba(0, 0, 0, 0.7)'
        });

        for (let i = 0; i < keys.length; i++) {
            const name = keys[i];
            const poolObj = activeObjectPools[name];

            let createdCount = 0;
            let availableCount = 0;

            if (poolObj.pool !== undefined) {
                availableCount = poolObj.pool.length;
                createdCount = poolObj.createdCount !== undefined ? poolObj.createdCount : poolObj.pool.length;
            }

            const inUseCount = createdCount - availableCount;
            const textY = startY + i * lineHeight;

            render('ui', {
                shape: 'text',
                text: `${name}: ${inUseCount} / ${createdCount}`,
                x: startX,
                y: textY,
                font: font,
                fill: '#FFFFFF',
                align: 'left',
                baseline: 'top'
            });
        }
    }
}
