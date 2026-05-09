import { render } from 'display/display_system.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';

const DEFAULT_ICON_COLOR = '#FFFFFF';
const ICON_STROKE_SCALE = 1.3;
const ICON_LINE_CAP = 'round';

/**
 * @class Icon
 * @description UI 아이콘 그리기 유틸리티 클래스입니다. 독립적인 위치/크기를 갖지 않고 주어진 사각형 범위 내에 자신을 그립니다.
 */
export class Icon {
    /**
     * @param {string} type - 아이콘 타입 ('arrow', 'confirm', 'deny', 'check')
     * @param {string} [color='#FFFFFF'] - 기본 색상
     */
    constructor(type, color = DEFAULT_ICON_COLOR) {
        this.type = type;
        this.color = color;
    }

    /**
     * 아이콘을 지정된 영역 안에 렌더링합니다.
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
        const safeX = resolveFiniteNumber(Number(x), 0);
        const safeY = resolveFiniteNumber(Number(y), 0);
        const safeWidth = clampFiniteNumber(Number(w), 0, Infinity, 0);
        const safeHeight = clampFiniteNumber(Number(h), 0, Infinity, 0);
        const renderColor = overrideColor || this.color || DEFAULT_ICON_COLOR;
        const cx = safeX + (safeWidth / 2);
        const cy = safeY + (safeHeight / 2);
        const strokeW = ICON_STROKE_SCALE * clampFiniteNumber(Number(scale), 0, Infinity, 1);
        const renderAlpha = clampFiniteNumber(Number(alpha), 0, 1, 1);

        if (this.type === 'arrow') {
            this._drawArrowIcon(layer, cx, cy, safeWidth, safeHeight, renderColor, strokeW, renderAlpha);
        } else if (this.type === 'confirm') {
            this._drawConfirmIcon(layer, cx, cy, safeWidth, renderColor, strokeW, renderAlpha);
        } else if (this.type === 'deny') {
            this._drawDenyIcon(layer, cx, cy, safeWidth, renderColor, strokeW, renderAlpha);
        } else if (this.type === 'check') {
            this._drawCheckIcon(layer, cx, cy, safeWidth, renderColor, strokeW, renderAlpha);
        }
    }

    /**
     * 화살표 아이콘을 렌더링합니다.
     * @param {string} layer - 렌더링 레이어입니다.
     * @param {number} cx - 중심 X 좌표입니다.
     * @param {number} cy - 중심 Y 좌표입니다.
     * @param {number} width - 아이콘 영역 너비입니다.
     * @param {number} height - 아이콘 영역 높이입니다.
     * @param {string} color - 렌더링 색상입니다.
     * @param {number} lineWidth - 선 두께입니다.
     * @param {number} alpha - 투명도입니다.
     */
    _drawArrowIcon(layer, cx, cy, width, height, color, lineWidth, alpha) {
        const arrowSize = Math.min(width, height);
        const halfSize = arrowSize * 0.385;
        const headLength = halfSize * 0.88;
        this._drawIconLine(layer, cx - halfSize, cy, cx + halfSize, cy, color, lineWidth, alpha);
        this._drawIconLine(
            layer,
            cx + halfSize - headLength,
            cy - headLength,
            cx + halfSize,
            cy,
            color,
            lineWidth,
            alpha
        );
        this._drawIconLine(
            layer,
            cx + halfSize - headLength,
            cy + headLength,
            cx + halfSize,
            cy,
            color,
            lineWidth,
            alpha
        );
    }

    /**
     * 확인 아이콘을 렌더링합니다.
     * @param {string} layer - 렌더링 레이어입니다.
     * @param {number} cx - 중심 X 좌표입니다.
     * @param {number} cy - 중심 Y 좌표입니다.
     * @param {number} width - 아이콘 영역 너비입니다.
     * @param {string} color - 렌더링 색상입니다.
     * @param {number} lineWidth - 선 두께입니다.
     * @param {number} alpha - 투명도입니다.
     */
    _drawConfirmIcon(layer, cx, cy, width, color, lineWidth, alpha) {
        render(layer, {
            shape: 'circle',
            x: cx,
            y: cy,
            radius: width * 0.45,
            fill: false,
            stroke: color,
            lineWidth,
            alpha
        });
    }

    /**
     * 거부 아이콘을 렌더링합니다.
     * @param {string} layer - 렌더링 레이어입니다.
     * @param {number} cx - 중심 X 좌표입니다.
     * @param {number} cy - 중심 Y 좌표입니다.
     * @param {number} width - 아이콘 영역 너비입니다.
     * @param {string} color - 렌더링 색상입니다.
     * @param {number} lineWidth - 선 두께입니다.
     * @param {number} alpha - 투명도입니다.
     */
    _drawDenyIcon(layer, cx, cy, width, color, lineWidth, alpha) {
        const halfSize = width * 0.35;
        this._drawIconLine(
            layer,
            cx - halfSize,
            cy - halfSize,
            cx + halfSize,
            cy + halfSize,
            color,
            lineWidth,
            alpha
        );
        this._drawIconLine(
            layer,
            cx + halfSize,
            cy - halfSize,
            cx - halfSize,
            cy + halfSize,
            color,
            lineWidth,
            alpha
        );
    }

    /**
     * 체크 아이콘을 렌더링합니다.
     * @param {string} layer - 렌더링 레이어입니다.
     * @param {number} cx - 중심 X 좌표입니다.
     * @param {number} cy - 중심 Y 좌표입니다.
     * @param {number} width - 아이콘 영역 너비입니다.
     * @param {string} color - 렌더링 색상입니다.
     * @param {number} lineWidth - 선 두께입니다.
     * @param {number} alpha - 투명도입니다.
     */
    _drawCheckIcon(layer, cx, cy, width, color, lineWidth, alpha) {
        const halfSize = width * 0.4;
        this._drawIconLine(
            layer,
            cx - halfSize,
            cy,
            cx - (halfSize * 0.2),
            cy + (halfSize * 0.8),
            color,
            lineWidth,
            alpha
        );
        this._drawIconLine(
            layer,
            cx - (halfSize * 0.2),
            cy + (halfSize * 0.8),
            cx + halfSize,
            cy - (halfSize * 0.8),
            color,
            lineWidth,
            alpha
        );
    }

    /**
     * 아이콘 선 렌더 명령을 전송합니다.
     * @param {string} layer - 렌더링 레이어입니다.
     * @param {number} x1 - 시작 X 좌표입니다.
     * @param {number} y1 - 시작 Y 좌표입니다.
     * @param {number} x2 - 끝 X 좌표입니다.
     * @param {number} y2 - 끝 Y 좌표입니다.
     * @param {string} color - 렌더링 색상입니다.
     * @param {number} lineWidth - 선 두께입니다.
     * @param {number} alpha - 투명도입니다.
     */
    _drawIconLine(layer, x1, y1, x2, y2, color, lineWidth, alpha) {
        render(layer, {
            shape: 'line',
            x1,
            y1,
            x2,
            y2,
            stroke: color,
            lineWidth,
            alpha,
            lineCap: ICON_LINE_CAP
        });
    }
}
