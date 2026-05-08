/**
 * 타이틀 메뉴 텍스트 프리셋 기준 폰트 크기를 반환합니다.
 * @param {object} textConstants - 텍스트 상수입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {string} presetKey - 텍스트 프리셋 키입니다.
 * @returns {number} 계산된 폰트 크기(px)입니다.
 */
export function getTitleMenuTextPresetFontSize(textConstants, uiww, presetKey) {
    const fallback = textConstants.H6;
    const preset = textConstants[presetKey] || fallback;
    const fontData = preset.FONT || fallback.FONT;
    const sizeValue = fontData?.SIZE?.VALUE || fallback.FONT.SIZE.VALUE;
    return uiww * (sizeValue / 100);
}

/**
 * 타이틀 메뉴 텍스트 프리셋을 캔버스용 폰트 문자열로 변환합니다.
 * @param {object} textConstants - 텍스트 상수입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {string} presetKey - 조회할 텍스트 프리셋 키입니다.
 * @param {number|null} [fontWeightOverride=null] - 강제로 적용할 폰트 굵기입니다.
 * @returns {string} 캔버스에 적용할 폰트 문자열입니다.
 */
export function getTitleMenuTextPresetFont(textConstants, uiww, presetKey, fontWeightOverride = null) {
    const fallback = textConstants.H6;
    const preset = textConstants[presetKey] || fallback;
    const fontData = preset.FONT || fallback.FONT;
    const weight = Number.isFinite(fontWeightOverride) ? fontWeightOverride : (fontData.WEIGHT || 400);
    const family = normalizeTitleMenuFontFamily(fontData.FAMILY || 'Pretendard Variable, arial');
    return `${weight} ${getTitleMenuTextPresetFontSize(textConstants, uiww, presetKey)}px ${family}`;
}

/**
 * 캔버스 렌더링용 폰트 패밀리 문자열을 정규화합니다.
 * @param {string} fontFamily - 원본 폰트 패밀리 문자열입니다.
 * @returns {string} 정규화된 폰트 패밀리 문자열입니다.
 */
export function normalizeTitleMenuFontFamily(fontFamily) {
    let familyStr = fontFamily;
    if (!familyStr.includes('"') && !familyStr.includes("'")) {
        const parts = familyStr.split(',');
        familyStr = `"${parts[0].trim()}"${parts[1] ? `,${parts[1]}` : ''}`;
    }
    return familyStr;
}
