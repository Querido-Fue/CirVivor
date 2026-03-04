import { LightTheme } from './light_theme.js';
import { DarkTheme } from './dark_theme.js';
export { LightTheme, DarkTheme };

/**
 * 기본으로 적용될 테마의 키워드
 */
export const DEFAULT_THEME_KEY = 'dark';

/**
 * 시스템에 등록된 테마 객체 목록
 */
export const THEMES = Object.freeze({
    light: LightTheme,
    dark: DarkTheme
});

export const THEME_KEYS = Object.freeze(Object.keys(THEMES));

/**
 * 테마 선택 메뉴 등에서 사용할 테마 옵션 데이터 배열
 */
export const THEME_OPTIONS = Object.freeze(
    THEME_KEYS.map((key) => Object.freeze({
        key,
        labelKey: `title_settings_theme_${key}`
    }))
);

/**
 * 키워드를 기반으로 테마 객체를 가져옵니다.
 * 매칭되는 테마가 없을 경우 기본 테마를 반환합니다.
 * @param {string} themeKey 찾을 테마 키
 * @returns {object} 테마 데이터 객체
 */
export const getThemeByKey = (themeKey) => {
    if (typeof themeKey === 'string' && Object.prototype.hasOwnProperty.call(THEMES, themeKey)) {
        return THEMES[themeKey];
    }
    return THEMES[DEFAULT_THEME_KEY];
};
