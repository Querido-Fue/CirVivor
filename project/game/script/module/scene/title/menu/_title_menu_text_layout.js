import { createFontString } from 'util/font_util.js';

/**
 * 타이틀 메뉴 텍스트 프리셋 기준 폰트 크기를 반환합니다.
 * @param {object} textConstants - 텍스트 상수입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {string} presetKey - 텍스트 프리셋 키입니다.
 * @param {number} [uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {number} 계산된 폰트 크기(px)입니다.
 */
export function getTitleMenuTextPresetFontSize(textConstants, uiww, presetKey, uiScale = 1) {
    const fallback = textConstants.H6;
    const preset = textConstants[presetKey] || fallback;
    const fontData = preset.FONT || fallback.FONT;
    const sizeValue = fontData?.SIZE?.VALUE || fallback.FONT.SIZE.VALUE;
    return uiww * (sizeValue / 100) * _normalizeTitleMenuUiScale(uiScale);
}

/**
 * 타이틀 메뉴 텍스트 프리셋을 캔버스용 폰트 문자열로 변환합니다.
 * @param {object} textConstants - 텍스트 상수입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {string} presetKey - 조회할 텍스트 프리셋 키입니다.
 * @param {number|null} [fontWeightOverride=null] - 강제로 적용할 폰트 굵기입니다.
 * @param {number} [uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {string} 캔버스에 적용할 폰트 문자열입니다.
 */
export function getTitleMenuTextPresetFont(
    textConstants,
    uiww,
    presetKey,
    fontWeightOverride = null,
    uiScale = 1
) {
    const fallback = textConstants.H6;
    const preset = textConstants[presetKey] || fallback;
    const fontData = preset.FONT || fallback.FONT;
    const weight = Number.isFinite(fontWeightOverride) ? fontWeightOverride : (fontData.WEIGHT || 400);
    return createFontString({
        weight,
        sizePx: getTitleMenuTextPresetFontSize(textConstants, uiww, presetKey, uiScale),
        family: fontData.FAMILY
    });
}

/**
 * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 스케일 배율입니다.
 * @returns {number} 정규화된 UI 스케일 배율입니다.
 */
function _normalizeTitleMenuUiScale(uiScale) {
    return Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
}
