/**
 * 공용 레이아웃 레시피에서 사용할 반응형 치수 값을 생성합니다.
 * @param {string} base - 치수 기준 단위입니다.
 * @param {number} value - 단위 기준 비율 값입니다.
 * @returns {{BASE:string, VALUE:number}} 동결된 치수 값입니다.
 */
function createMetric(base, value) {
    return Object.freeze({ BASE: base, VALUE: value });
}

/**
 * 반복되는 오버레이 간격 토큰입니다.
 */
export const UI_SPACING = Object.freeze({
    OVERLAY_PAGE_PADDING_X: createMetric('WW', 1.8),
    DIALOG_PADDING_X: createMetric('WW', 1.5),
    OVERLAY_TITLE_TOP: createMetric('WH', 2.5),
    OVERLAY_TITLE_DIVIDER_GAP: createMetric('WH', 1.5),
    DIALOG_BODY_GAP: createMetric('WH', 1.4),
    OVERLAY_FOOTER_BOTTOM: createMetric('WH', 2.5)
});

/**
 * 반복되는 UI 모서리 반경 토큰입니다.
 */
export const UI_RADIUS = Object.freeze({
    OVERLAY_PANEL: createMetric('WW', 0.6)
});
