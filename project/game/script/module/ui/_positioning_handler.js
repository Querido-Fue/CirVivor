import { getWW, getWH, getUIWW } from 'display/display_system.js';

/**
 * @class PositioningHandler
 * @description UI 단위(WW/WH/OW/OH/OX/OY/absolute/parent) 기반 좌표 계산을 담당합니다.
 */
export class PositioningHandler {
    constructor(parent, uiScale = 1) {
        this.resize(parent, uiScale);
    }

    /**
     * 화면/부모 상태가 바뀌었을 때 참조값을 갱신합니다.
     * @param {object} parent
     * @param {number} uiScale
     * @returns {PositioningHandler}
     */
    resize(parent = this.parent, uiScale = this.uiScale) {
        this.parent = parent;
        this.uiScale = uiScale || 1;
        return this;
    }

    /**
     * 단위를 실제 픽셀 값으로 변환합니다.
     * @param {string} unit
     * @param {number} value
     * @param {number} [refSize]
     * @returns {number}
     */
    parseUnit(unit, value, refSize) {
        if (unit === 'parent') {
            return (value / 100) * (refSize || 0);
        }

        let maxVal = 0;
        switch (unit) {
            case 'WW':
                maxVal = getUIWW();
                break;
            case 'WH':
                maxVal = getWH();
                break;
            case 'OW':
                maxVal = this.parent.scaledW !== undefined
                    ? this.parent.scaledW
                    : (this.parent.width || getWW());
                break;
            case 'OH':
                maxVal = this.parent.scaledH !== undefined
                    ? this.parent.scaledH
                    : (this.parent.height || getWH());
                break;
            case 'OX': {
                const base = this.parent.scaledX !== undefined ? this.parent.scaledX : (this.parent.x || 0);
                const w = this.parent.scaledW !== undefined
                    ? this.parent.scaledW
                    : (this.parent.width || getWW());
                return base + (value / 100) * w;
            }
            case 'OY': {
                const base = this.parent.scaledY !== undefined ? this.parent.scaledY : (this.parent.y || 0);
                const h = this.parent.scaledH !== undefined
                    ? this.parent.scaledH
                    : (this.parent.height || getWH());
                return base + (value / 100) * h;
            }
            case 'absolute':
                return value * this.uiScale;
            default:
                return 0;
        }

        if (unit === 'WW' || unit === 'WH') {
            return (value / 100) * maxVal * this.uiScale;
        }

        return (value / 100) * maxVal;
    }

    /**
     * 루트 레이아웃 영역(start/size/margin)을 계산합니다.
     * @param {object} layoutStart
     * @param {object} layoutSize
     * @param {object} horMargin
     * @returns {{startX:number,startY:number,layoutW:number,layoutH:number,innerX:number,innerW:number}}
     */
    resolveLayoutFrame(layoutStart, layoutSize, horMargin) {
        const startX = this.parseUnit(layoutStart.x.unit, layoutStart.x.value, getWW());
        const startY = this.parseUnit(layoutStart.y.unit, layoutStart.y.value, getWH());
        const layoutW = this.parseUnit(layoutSize.w.unit, layoutSize.w.value, getWW());
        const layoutH = this.parseUnit(layoutSize.h.unit, layoutSize.h.value, getWH());
        const horMarginPx = this.parseUnit(horMargin.unit, horMargin.value, layoutW);
        const innerW = layoutW - (horMarginPx * 2);
        const innerX = startX + horMarginPx;

        return { startX, startY, layoutW, layoutH, innerX, innerW };
    }

    /**
     * 정렬 값(left/center/right)에 따라 최종 X 좌표를 반환합니다.
     * @param {string} align
     * @param {number} baseX
     * @param {number} parentW
     * @param {number} itemW
     * @returns {number}
     */
    resolveAlignedX(align, baseX, parentW, itemW) {
        if (align === 'center') return baseX + (parentW / 2) - (itemW / 2);
        if (align === 'right') return baseX + parentW - itemW;
        return baseX;
    }
}
