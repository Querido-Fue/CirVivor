const DEFAULT_FONT_FAMILY = 'Pretendard Variable, arial';
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FONT_SIZE_PX = 12;

/**
 * Canvas 폰트 문자열에서 공백이 포함된 첫 번째 폰트 패밀리를 따옴표로 감쌉니다.
 * @param {string} [fontFamily=DEFAULT_FONT_FAMILY] - 정규화할 폰트 패밀리 문자열입니다.
 * @returns {string} Canvas 폰트 문자열에 사용할 수 있는 패밀리 문자열입니다.
 */
export function normalizeFontFamily(fontFamily = DEFAULT_FONT_FAMILY) {
    let familyStr = String(fontFamily || DEFAULT_FONT_FAMILY);
    if (!familyStr.includes('"') && !familyStr.includes("'")) {
        const parts = familyStr.split(',');
        familyStr = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
    }
    return familyStr;
}

/**
 * Canvas 2D에서 사용할 font 속성 문자열을 생성합니다.
 * @param {{weight?: string|number, sizePx?: number, family?: string}} [options={}] - 폰트 문자열 구성 옵션입니다.
 * @returns {string} Canvas font 속성 문자열입니다.
 */
export function createFontString(options = {}) {
    const sizePx = Number.isFinite(options.sizePx) ? options.sizePx : DEFAULT_FONT_SIZE_PX;
    const weightPrefix = options.weight !== undefined && options.weight !== null && options.weight !== ''
        ? `${options.weight} `
        : '';
    return `${weightPrefix}${sizePx}px ${normalizeFontFamily(options.family || DEFAULT_FONT_FAMILY)}`;
}

/**
 * 텍스트 프리셋 데이터에서 Canvas font 속성 문자열을 생성합니다.
 * @param {object} presetData - 텍스트 프리셋 데이터입니다.
 * @param {object} [options={}] - 프리셋 해석 옵션입니다.
 * @param {object} [options.fallbackData] - 프리셋 누락 시 사용할 폴백 데이터입니다.
 * @param {string|number} [options.defaultWeight=DEFAULT_FONT_WEIGHT] - 기본 폰트 두께입니다.
 * @param {string} [options.defaultFamily=DEFAULT_FONT_FAMILY] - 기본 폰트 패밀리입니다.
 * @param {(sizeData: object) => number} [options.resolveSizePx] - SIZE 데이터를 실제 픽셀 값으로 변환하는 함수입니다.
 * @returns {string} Canvas font 속성 문자열입니다.
 */
export function createFontStringFromPreset(presetData, options = {}) {
    const fallbackFontData = options.fallbackData?.FONT || {};
    const fontData = presetData?.FONT || fallbackFontData;
    const sizeData = fontData.SIZE || fallbackFontData.SIZE || {};
    const sizePx = typeof options.resolveSizePx === 'function'
        ? options.resolveSizePx(sizeData)
        : (Number.isFinite(sizeData.VALUE) ? sizeData.VALUE : DEFAULT_FONT_SIZE_PX);

    return createFontString({
        sizePx,
        weight: fontData.WEIGHT || fallbackFontData.WEIGHT || options.defaultWeight || DEFAULT_FONT_WEIGHT,
        family: fontData.FAMILY || fallbackFontData.FAMILY || options.defaultFamily || DEFAULT_FONT_FAMILY
    });
}
