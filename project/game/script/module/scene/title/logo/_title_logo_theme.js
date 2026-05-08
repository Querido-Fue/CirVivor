import { ColorSchemes } from 'display/_theme_handler.js';

/**
 * 현재 테마를 기준으로 기본 로고 색상을 반환합니다.
 * @returns {string} 로고 기본 색상
 */
export function getDefaultLogoColor() {
    return ColorSchemes?.Title?.Logo?.Fill
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Foreground;
}

/**
 * 현재 테마를 기준으로 로고 그림자 색상을 반환합니다.
 * @returns {string} 로고 그림자 색상
 */
export function getDefaultLogoShadowColor() {
    return ColorSchemes?.Title?.Logo?.Shadow
        || ColorSchemes?.Title?.Background
        || ColorSchemes?.Background
        || ColorSchemes?.Title?.TextDark;
}
