const UI_WIDTH_UNIT = 'WW';
const UI_HEIGHT_UNIT = 'WH';

/**
 * 툴팁 레이아웃 단위 값을 생성합니다.
 * @param {string} base - 기준 단위입니다.
 * @param {number} value - 단위 기준 비율 값입니다.
 * @returns {{BASE:string, VALUE:number}} 툴팁 레이아웃 단위 값입니다.
 */
function createMetric(base, value) {
    return Object.freeze({
        BASE: base,
        VALUE: value
    });
}

/**
 * 마우스 툴팁의 레이아웃과 표시 규칙 상수입니다.
 */
export const TOOLTIP_CONSTANTS = Object.freeze({
    SURFACE_ORDER: 190000,
    OFFSET_X: createMetric(UI_WIDTH_UNIT, 0.9),
    SCREEN_MARGIN: createMetric(UI_WIDTH_UNIT, 0.8),
    MAX_WIDTH: createMetric(UI_WIDTH_UNIT, 18),
    PADDING_X: createMetric(UI_HEIGHT_UNIT, 0.7),
    PADDING_Y: createMetric(UI_HEIGHT_UNIT, 0.7),
    TITLE_GAP: createMetric(UI_HEIGHT_UNIT, 0.35),
    BODY_LINE_GAP: createMetric(UI_HEIGHT_UNIT, 0.18),
    PANEL_RADIUS: createMetric(UI_HEIGHT_UNIT, 0.4),
    BORDER_COLOR: '#404040',
    BORDER_WIDTH: 1,
    LINE_HEIGHT_MULTIPLIER: 1.35,
    MAX_LINES: 10
});
