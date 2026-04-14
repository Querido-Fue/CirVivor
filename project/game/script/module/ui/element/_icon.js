import { render } from "display/display_system.js";

/**
 * @class Icon
 * @description UI 아이콘 그리기 유틸리티 클래스입니다. 독립적인 위치/크기를 갖지 않고 주어진 사각형 범위 내에 자신을 그립니다.
 */
export class Icon {
    /**
     * @param {string} type - 아이콘 타입 ('arrow', 'confirm', 'deny', 'check')
     * @param {string} [color='#FFFFFF'] - 기본 색상
     */
    constructor(type, color = '#FFFFFF') {
        this.type = type;
        this.color = color;
    }

    /**
     * @param {string} layer - 렌더링 레이어
     * @param {number} x - 렌더링 시작 X 좌표 (bounding box 왼쪽 상단)
     * @param {number} y - 렌더링 시작 Y 좌표 (bounding box 왼쪽 상단)
     * @param {number} w - bounding box 너비
     * @param {number} h - bounding box 높이
     * @param {number} [scale=1] - 선 굵기 등 스케일 보정
     * @param {number} [alpha=1] - 투명도
     * @param {string} [overrideColor=null] - 색상 오버라이드
     */
    draw(layer, x, y, w, h, scale = 1, alpha = 1, overrideColor = null) {
        const renderColor = overrideColor || this.color;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const strokeW = 1.3 * scale;

        if (this.type === 'arrow') {
            const arrowSize = Math.min(w, h);
            const hs = arrowSize * 0.385;
            const headLength = hs * 0.88;
            // 몸통 선
            render(layer, {
                shape: 'line',
                x1: cx - hs, y1: cy,
                x2: cx + hs, y2: cy,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
            // 위쪽 화살촉
            render(layer, {
                shape: 'line',
                x1: cx + hs - headLength, y1: cy - headLength,
                x2: cx + hs, y2: cy,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
            // 아래쪽 화살촉
            render(layer, {
                shape: 'line',
                x1: cx + hs - headLength, y1: cy + headLength,
                x2: cx + hs, y2: cy,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
        } else if (this.type === 'confirm') {
            // 동그라미 아이콘
            render(layer, {
                shape: 'circle',
                x: cx,
                y: cy,
                radius: w * 0.45,
                fill: false,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha
            });
        } else if (this.type === 'deny') {
            // 엑스 아이콘
            const hs = w * 0.35;
            render(layer, {
                shape: 'line',
                x1: cx - hs, y1: cy - hs,
                x2: cx + hs, y2: cy + hs,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
            render(layer, {
                shape: 'line',
                x1: cx + hs, y1: cy - hs,
                x2: cx - hs, y2: cy + hs,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
        } else if (this.type === 'check') {
            // 체크 아이콘 (V 형태)
            const hs = w * 0.4;
            render(layer, {
                shape: 'line',
                x1: cx - hs, y1: cy,
                x2: cx - hs * 0.2, y2: cy + hs * 0.8,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
            render(layer, {
                shape: 'line',
                x1: cx - hs * 0.2, y1: cy + hs * 0.8,
                x2: cx + hs, y2: cy - hs * 0.8,
                stroke: renderColor,
                lineWidth: strokeW,
                alpha: alpha,
                lineCap: 'round'
            });
        }
    }
}
