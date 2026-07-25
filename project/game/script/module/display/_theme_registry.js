import {
    DEFAULT_THEME_KEY,
    THEMES
} from 'data/theme/theme_registry.js';

/**
 * 키워드를 기반으로 테마 객체를 가져옵니다.
 * 매칭되는 테마가 없을 경우 기본 테마를 반환합니다.
 * @param {string} themeKey - 찾을 테마 키입니다.
 * @returns {object} 테마 데이터 객체입니다.
 */
export const getThemeByKey = (themeKey) => {
    if (typeof themeKey === 'string' && Object.prototype.hasOwnProperty.call(THEMES, themeKey)) {
        return THEMES[themeKey];
    }
    return THEMES[DEFAULT_THEME_KEY];
};
