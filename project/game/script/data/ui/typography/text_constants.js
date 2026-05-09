const UI_WIDTH_UNIT = 'WW';
const DEFAULT_TEXT_FONT_FAMILY = 'Pretendard Variable, arial';

/**
 * 텍스트 크기 단위 값을 생성합니다.
 * @param {number} value - WW 기준 폰트 크기 값입니다.
 * @returns {{BASE:string, VALUE:number}} 텍스트 크기 단위 값입니다.
 */
function createTextSize(value) {
    return Object.freeze({
        BASE: UI_WIDTH_UNIT,
        VALUE: value
    });
}

/**
 * 텍스트 프리셋을 생성합니다.
 * @param {number} sizeValue - WW 기준 폰트 크기 값입니다.
 * @param {number} weight - 폰트 굵기입니다.
 * @returns {{FONT:{SIZE:{BASE:string, VALUE:number}, WEIGHT:number, FAMILY:string}}} 텍스트 프리셋입니다.
 */
function createTextPreset(sizeValue, weight) {
    return Object.freeze({
        FONT: Object.freeze({
            SIZE: createTextSize(sizeValue),
            WEIGHT: weight,
            FAMILY: DEFAULT_TEXT_FONT_FAMILY
        })
    });
}

/**
 * 텍스트 렌더링에 사용되는 타이포그래피 설정 상수 모음입니다.
 */
export const TEXT_CONSTANTS = Object.freeze({
    H1: createTextPreset(2, 700),
    H2: createTextPreset(1.6, 600),
    H3: createTextPreset(1.3, 400),
    H3_BOLD: createTextPreset(1.3, 700),
    H4: createTextPreset(1.1, 300),
    H4_BOLD: createTextPreset(1.1, 700),
    H5: createTextPreset(1, 300),
    H5_BOLD: createTextPreset(1, 700),
    H6: createTextPreset(0.85, 300),
    H6_BOLD: createTextPreset(0.85, 700),
    SETTINGS_DESC: createTextPreset(0.9, 300),
    SETTINGS_SLIDER_VALUE: createTextPreset(0.9, 400)
});
