import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';

/**
 * 로고/배경에서 사용할 기본 적 색상을 반환합니다.
 * @returns {string} 적 기본 색상
 */
export function getTitleEnemyColor() {
    return ColorSchemes?.Title?.Enemy
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Background;
}

/**
 * 배경에서 사용할 기본 색상을 반환합니다.
 * @returns {string} 배경 기본 색상
 */
export function getTitleBackgroundColor() {
    return ColorSchemes?.Title?.Background
        || ColorSchemes?.Background;
}

/**
 * 적 색상과 배경색을 RGB 기준으로 섞어 거리감을 만듭니다.
 * @param {number} mixRatio - 배경색으로 섞을 비율입니다.
 * @returns {string} 혼합된 RGBA 문자열입니다.
 */
export function mixTitleEnemyColorWithBackground(mixRatio) {
    const ratio = Number.isFinite(mixRatio) ? Math.max(0, Math.min(1, mixRatio)) : 0;
    const util = colorUtil();
    const enemyColor = util.cssToRgb(getTitleEnemyColor());
    const backgroundColor = util.cssToRgb(getTitleBackgroundColor());
    if (!enemyColor || !backgroundColor) {
        return 'transparent';
    }
    const r = enemyColor.r + ((backgroundColor.r - enemyColor.r) * ratio);
    const g = enemyColor.g + ((backgroundColor.g - enemyColor.g) * ratio);
    const b = enemyColor.b + ((backgroundColor.b - enemyColor.b) * ratio);
    return util.rgbToString(r, g, b, 1);
}
