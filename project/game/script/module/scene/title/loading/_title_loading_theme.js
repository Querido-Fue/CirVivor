import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';

/**
 * 로딩 화면 텍스트에 사용할 기본 색상을 반환합니다.
 * @returns {string} 로딩 텍스트 색상
 */
export function getLoadingTextColor() {
    return ColorSchemes?.Title?.Loading?.Text
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Foreground;
}

/**
 * 로딩 액센트 색상을 반환합니다.
 * @returns {string} 로딩 액센트 색상
 */
export function getLoadingAccentColor() {
    return ColorSchemes?.Title?.Loading?.Accent
        || ColorSchemes?.Title?.Menu?.Accent
        || ColorSchemes?.Cursor?.Active
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text;
}

/**
 * 로딩 완료 후 표시할 로고 기본 색상을 반환합니다.
 * @returns {string} 로고 색상입니다.
 */
export function getLoadingLogoColor() {
    return ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Logo?.Fill
        || ColorSchemes?.Title?.Menu?.Foreground;
}

/**
 * 로딩 skip 버튼의 기본 색상을 반환합니다.
 * @returns {{text:string, idleColor:string, hoverColor:string}} skip 버튼 색상
 */
export function getLoadingSkipButtonStyle() {
    const accent = getLoadingAccentColor();
    const skipButton = ColorSchemes?.Title?.Loading?.SkipButton;
    return {
        text: skipButton?.Text || getLoadingTextColor(),
        idleColor: skipButton?.Idle || toAccentRgba(accent, 0.12),
        hoverColor: skipButton?.Hover || toAccentRgba(accent, 0.22)
    };
}

/**
 * rgba 형식 문자열에서 rgb 값으로 변환 후 알파를 붙여 반환합니다.
 * @param {string} color - css 색상 문자열
 * @param {number} alpha - 알파 값
 * @returns {string} rgba 문자열
 */
function toAccentRgba(color, alpha) {
    const safeAlpha = Number.isFinite(alpha) ? alpha : 1;
    const parsed = colorUtil().cssToRgb(color);
    if (!parsed) {
        const fallback = colorUtil().cssToRgb(getLoadingTextColor());
        if (!fallback) {
            return 'transparent';
        }
        return `rgba(${fallback.r}, ${fallback.g}, ${fallback.b}, ${safeAlpha})`;
    }
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${safeAlpha})`;
}
