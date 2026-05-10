const UI_WIDTH_UNIT = 'WW';
const UI_HEIGHT_UNIT = 'WH';
const DEFAULT_BUTTON_FONT_FAMILY = 'Pretendard Variable, arial';
const OVERLAY_BUTTON_ALIGN = 'right';

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
 * 버튼 폰트 프리셋을 생성합니다.
 * @param {number} sizeValue - WW 기준 폰트 크기 값입니다.
 * @param {number} weight - 폰트 굵기입니다.
 * @returns {{SIZE:{BASE:string, VALUE:number}, WEIGHT:number, FAMILY:string}} 버튼 폰트 프리셋입니다.
 */
function createButtonFont(sizeValue, weight) {
    return Object.freeze({
        SIZE: createMetric(UI_WIDTH_UNIT, sizeValue),
        WEIGHT: weight,
        FAMILY: DEFAULT_BUTTON_FONT_FAMILY
    });
}

/**
 * 오버레이 버튼 프리셋을 생성합니다.
 * @param {object} options - 버튼 프리셋 옵션입니다.
 * @param {number} options.width - WW 기준 너비 값입니다.
 * @param {number} options.height - WH 기준 높이 값입니다.
 * @param {number} options.margin - WW 기준 마진 값입니다.
 * @param {number} options.radius - WW 기준 모서리 반경 값입니다.
 * @param {number} options.fontSize - WW 기준 폰트 크기 값입니다.
 * @param {number} options.fontWeight - 폰트 굵기입니다.
 * @param {string} [options.iconType] - 버튼 아이콘 타입입니다.
 * @returns {object} 오버레이 버튼 프리셋입니다.
 */
function createOverlayButtonPreset(options) {
    const preset = {
        WIDTH: createMetric(UI_WIDTH_UNIT, options.width),
        HEIGHT: createMetric(UI_HEIGHT_UNIT, options.height),
        MARGIN: createMetric(UI_WIDTH_UNIT, options.margin),
        RADIUS: createMetric(UI_WIDTH_UNIT, options.radius),
        FONT: createButtonFont(options.fontSize, options.fontWeight),
        ALIGN: OVERLAY_BUTTON_ALIGN
    };

    if (options.iconType) {
        preset.ICON_TYPE = options.iconType;
    }

    return Object.freeze(preset);
}

/**
 * UI 버튼 레이아웃 및 폰트 관련 설정 상수 모음입니다.
 */
export const BUTTON_CONSTANTS = Object.freeze({
    OVERLAY_INTERACT_BUTTON: createOverlayButtonPreset({
        width: 7,
        height: 3.5,
        margin: 0.8,
        radius: 0.3,
        fontSize: 1,
        fontWeight: 600
    }),
    OVERLAY_LINK_BUTTON: createOverlayButtonPreset({
        width: 6,
        height: 3,
        margin: 0.65,
        radius: 0.3,
        fontSize: 0.8,
        fontWeight: 500,
        iconType: 'arrow'
    })
});
