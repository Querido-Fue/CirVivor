import { getData } from 'data/data_handler.js';
import { getWW, getWH, getUIWW } from 'display/display_system.js';

const BUTTON_CONSTANTS = getData('BUTTON_CONSTANTS');
const UI_CONSTANTS = getData('UI_CONSTANTS');
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');

const UI_DATA_NAMESPACES = {
    UI_CONSTANTS,
    BUTTON_CONSTANTS,
    TEXT_CONSTANTS,
};

/**
 * @private
 * 중첩 객체 내부 특정 경로의 UI 상수 데이터를 탐색합니다.
 * @param {string} path "UI_CONSTANTS.BUTTON.WIDTH"와 같은 참조 경로 문자열
 * @returns {*}
 */
const resolveUIDataByPath = (path) => {
    const keys = path.split('.');
    let current = UI_DATA_NAMESPACES;

    for (const key of keys) {
        if (current === null || current === undefined || typeof current !== 'object') {
            console.warn(`[PositioningHandler] "${path}" 경로를 찾을 수 없습니다. ("${key}" 에서 탐색 실패)`);
            return null;
        }
        current = current[key];
    }

    if (current === null || current === undefined) {
        console.warn(`[PositioningHandler] "${path}" 경로의 값이 없습니다.`);
        return null;
    }

    return current;
};

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
     * 문자열 경로 또는 { BASE, VALUE } 객체를 실제 픽셀 float 값으로 변환합니다.
     * @param {string|{ BASE: string, VALUE: number }|number} data
     * @param {number} [uiScale=this.uiScale]
     * @returns {number}
     */
    parseUIData(data, uiScale = this.uiScale) {
        if (data === null || data === undefined) {
            console.warn('[PositioningHandler] parseUIData()에 null 또는 undefined가 전달되었습니다.');
            return 0;
        }

        if (typeof data === 'number') return data;

        let resolvedData = data;
        if (typeof resolvedData === 'string') {
            resolvedData = resolveUIDataByPath(resolvedData);
            if (resolvedData === null) return 0;
        }

        if (typeof resolvedData !== 'object' || resolvedData.BASE === undefined || resolvedData.VALUE === undefined) {
            console.warn('[PositioningHandler] parseUIData()에 유효하지 않은 데이터가 전달되었습니다:', data);
            return 0;
        }

        return this.parseUnit(resolvedData.BASE, resolvedData.VALUE, undefined, uiScale);
    }

    /**
     * 단위를 실제 픽셀 값으로 변환합니다.
     * @param {string} unit
     * @param {number} value
     * @param {number} [refSize]
     * @param {number} [scale=this.uiScale]
     * @returns {number}
     */
    parseUnit(unit, value, refSize, scale = this.uiScale) {
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
                return value * scale;
            default:
                return 0;
        }

        if (unit === 'WW' || unit === 'WH') {
            return (value / 100) * maxVal * scale;
        }

        return (value / 100) * maxVal;
    }

    /**
     * 루트 레이아웃 영역(start/size/padding)을 계산합니다.
     * @param {object} layoutStart
     * @param {object} layoutSize
     * @param {object} paddingX
     * @returns {{startX:number,startY:number,layoutW:number,layoutH:number,innerX:number,innerW:number}}
     */
    resolveLayoutFrame(layoutStart, layoutSize, paddingX) {
        const startX = this.parseUnit(layoutStart.x.unit, layoutStart.x.value, getWW());
        const startY = this.parseUnit(layoutStart.y.unit, layoutStart.y.value, getWH());
        const layoutW = this.parseUnit(layoutSize.w.unit, layoutSize.w.value, getWW());
        const layoutH = this.parseUnit(layoutSize.h.unit, layoutSize.h.value, getWH());
        const paddingXPx = this.parseUnit(paddingX.unit, paddingX.value, layoutW);
        const innerW = layoutW - (paddingXPx * 2);
        const innerX = startX + paddingXPx;

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

/**
 * 문자열 기반 UI 상수 데이터를 실제 값으로 변환합니다.
 * @param {string|object|number} data - 파싱할 UI 데이터
 * @param {number} [uiScale=1] - UI 스케일 배율
 * @returns {number} 파싱된 수치 값
 */
export const parseUIData = (data, uiScale = 1) => {
    const handler = new PositioningHandler({}, uiScale);
    return handler.parseUIData(data, uiScale);
};
