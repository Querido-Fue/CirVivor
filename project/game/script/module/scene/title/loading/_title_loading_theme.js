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
        idleColor: skipButton?.Idle || toLoadingRgba(accent, 0.12, getLoadingTextColor()),
        hoverColor: skipButton?.Hover || toLoadingRgba(accent, 0.22, getLoadingTextColor())
    };
}

/**
 * CSS 색상 문자열과 알파값으로 로딩 UI rgba 문자열을 생성합니다.
 * @param {string|null|undefined} color - css 색상 문자열
 * @param {number} alpha - 알파 값
 * @param {string|null|undefined} [fallbackColor=getLoadingAccentColor()] - 변환 실패 시 사용할 색상 문자열
 * @returns {string} rgba 문자열
 */
export function toLoadingRgba(color, alpha, fallbackColor = getLoadingAccentColor()) {
    const safeAlpha = Number.isFinite(alpha) ? alpha : 0;
    const parsed = colorUtil().cssToRgb(color);
    if (!parsed) {
        const fallback = colorUtil().cssToRgb(fallbackColor)
            || colorUtil().cssToRgb(getLoadingAccentColor())
            || colorUtil().cssToRgb(getLoadingTextColor());
        if (!fallback) {
            return 'transparent';
        }
        return `rgba(${fallback.r}, ${fallback.g}, ${fallback.b}, ${safeAlpha})`;
    }

    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${safeAlpha})`;
}
