import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil, formatRgba } from 'util/color_util.js';

/**
 * 타이틀 카드 연출에서 사용할 포인트 블루 색상입니다.
 * @type {{readonly r:number, readonly g:number, readonly b:number}}
 */
const TITLE_BENTO_ACCENT_RGB = Object.freeze({
    r: 22,
    g: 111,
    b: 251
});

/**
 * 액센트 컬러를 rgba 문자열로 반환합니다.
 * @param {number} alpha - 알파값
 * @returns {string} rgba 색상 문자열
 */
export function getBentoAccentColor(alpha) {
    return formatRgba(TITLE_BENTO_ACCENT_RGB.r, TITLE_BENTO_ACCENT_RGB.g, TITLE_BENTO_ACCENT_RGB.b, alpha);
}

/**
 * 카드 팔레트를 현재 테마에 맞춰 계산합니다.
 * @returns {object} 카드 렌더링용 색상 팔레트
 */
export function getBentoCardPalette() {
    const titleBackground = ColorSchemes?.Title?.Background || '#101010';
    const isDarkTheme = getPerceivedBrightness(titleBackground) < 140;

    if (isDarkTheme) {
        return {
            topFill: 'rgba(8, 11, 18, 0.84)',
            bottomFill: 'rgba(12, 16, 24, 0.78)',
            overlayTop: 'rgba(255, 255, 255, 0.03)',
            overlayBottom: 'rgba(255, 255, 255, 0.01)',
            border: 'rgba(255, 255, 255, 0.78)',
            text: '#f7f9fc',
            description: 'rgba(247, 249, 252, 0.78)',
            shadow: 'rgba(0, 0, 0, 0.32)'
        };
    }

    return {
        topFill: 'rgba(255, 255, 255, 0.8)',
        bottomFill: 'rgba(244, 248, 255, 0.76)',
        overlayTop: 'rgba(255, 255, 255, 0.12)',
        overlayBottom: 'rgba(22, 32, 46, 0.03)',
        border: 'rgba(32, 32, 32, 0.48)',
        text: '#141821',
        description: 'rgba(20, 24, 33, 0.78)',
        shadow: 'rgba(16, 22, 32, 0.15)'
    };
}

/**
 * 테마 배경의 지각 밝기를 계산합니다.
 * @param {string} cssColor - CSS 색상 문자열
 * @returns {number} 0~255 범위 밝기
 */
function getPerceivedBrightness(cssColor) {
    const util = colorUtil();
    if (!util) {
        return 0;
    }

    const rgb = util.cssToRgb(cssColor);
    if (!rgb) {
        return 0;
    }
    return ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
}
