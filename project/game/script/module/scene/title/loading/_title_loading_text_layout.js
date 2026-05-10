import { getLangString } from 'ui/ui_system.js';
import { parseUIData } from 'ui/layout/_positioning_handler.js';
import { createFontString } from 'util/font_util.js';

/**
 * 현재 화면 기준으로 로딩 텍스트 배치 정보를 계산합니다.
 * @param {object} options - 배치 계산 옵션입니다.
 * @param {{x:number, y:number}} options.textAnchor - 로딩 텍스트 기준점입니다.
 * @param {object} options.textConstants - 텍스트 프리셋 상수입니다.
 * @param {object} options.titleLoading - 타이틀 로딩 상수입니다.
 * @param {number} options.wh - 현재 화면 높이입니다.
 * @returns {object} 로딩 텍스트 배치 정보입니다.
 */
export function buildTitleLoadingTextLayout({ textAnchor, textConstants, titleLoading, wh }) {
    const titleFontSize = getTitleLoadingTextPresetFontSize(textConstants, 'H5');
    const noticeFontSize = getTitleLoadingTextPresetFontSize(textConstants, 'H6');
    const noticeGap = Math.max(10, wh * 0.014);
    const loadingTextX = textAnchor.x;
    const loadingTextY = textAnchor.y;
    const loadingNoticeLines = getTitleLoadingNoticeLines();
    const loadingNoticeLineHeight = Math.max(noticeFontSize * 1.45, wh * 0.018);
    const loadingNoticeStartY = loadingTextY + (titleFontSize * 0.5) + noticeGap + (noticeFontSize * 0.5);
    const loadingTextBlockBottomY = loadingNoticeLines.length > 0
        ? loadingNoticeStartY + (loadingNoticeLineHeight * (loadingNoticeLines.length - 1)) + (noticeFontSize * 0.5)
        : loadingTextY + (titleFontSize * 0.5);

    return {
        loadingTextX,
        loadingTextY,
        loadingTextFontSize: titleFontSize,
        loadingTextFont: getTitleLoadingTextPresetFont(textConstants, 'H5'),
        loadingNoticeFontSize: noticeFontSize,
        loadingNoticeFont: getTitleLoadingTextPresetFont(textConstants, 'H6'),
        loadingNoticeLines,
        loadingNoticeLineHeight,
        loadingNoticeStartY,
        loadingTextBlockBottomY,
        loadingTextExitDistance: Math.max(10, wh * titleLoading.TEXT_EXIT_DISTANCE_RATIO)
    };
}

/**
 * 로딩 안내 문구를 줄 단위 배열로 반환합니다.
 * @returns {string[]} 렌더링할 안내 문구 줄 목록입니다.
 */
export function getTitleLoadingNoticeLines() {
    return String(getLangString('title_loading_notice') || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * 지정한 텍스트 프리셋의 폰트 크기를 픽셀 단위로 반환합니다.
 * @param {object} textConstants - 텍스트 프리셋 상수입니다.
 * @param {string} presetKey - 조회할 텍스트 프리셋 키입니다.
 * @returns {number} 프리셋에서 계산된 폰트 크기입니다.
 */
export function getTitleLoadingTextPresetFontSize(textConstants, presetKey) {
    const fallback = textConstants.H6;
    const preset = textConstants[presetKey] || fallback;
    const fontData = preset.FONT || fallback.FONT;
    return Math.max(8, parseUIData(fontData.SIZE));
}

/**
 * 지정한 텍스트 프리셋을 캔버스용 폰트 문자열로 변환합니다.
 * @param {object} textConstants - 텍스트 프리셋 상수입니다.
 * @param {string} presetKey - 조회할 텍스트 프리셋 키입니다.
 * @returns {string} 캔버스 렌더링에 사용할 폰트 문자열입니다.
 */
export function getTitleLoadingTextPresetFont(textConstants, presetKey) {
    const fallback = textConstants.H6;
    const preset = textConstants[presetKey] || fallback;
    const fontData = preset.FONT || fallback.FONT;
    return createFontString({
        weight: fontData.WEIGHT || 400,
        sizePx: getTitleLoadingTextPresetFontSize(textConstants, presetKey),
        family: fontData.FAMILY
    });
}
