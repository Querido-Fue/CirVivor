const UI_WIDTH_UNIT = 'WW';

/**
 * 레이아웃 단위 값을 생성합니다.
 * @param {string} base - 기준 단위입니다.
 * @param {number} value - 단위 기준 비율 값입니다.
 * @returns {{BASE:string, VALUE:number}} 레이아웃 단위 값입니다.
 */
function createMetric(base, value) {
    return Object.freeze({
        BASE: base,
        VALUE: value
    });
}

/**
 * 일반 UI 컴포넌트 레이아웃 상수 모음입니다.
 */
export const UI_CONSTANTS = Object.freeze({
    OVERLAY_PANEL_RADIUS: createMetric(UI_WIDTH_UNIT, 0.6)
});
