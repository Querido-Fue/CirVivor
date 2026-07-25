import { DEFAULT_THEME_KEY, THEMES } from 'data/theme/theme_registry.js';
import { setBackgroundColor } from 'display/display_system.js';
import { colorUtil } from 'util/color_util.js';
import { getThemeByKey } from './_theme_registry.js';
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

/**
 * 모든 import가 공유하는 live 색상 스킴 객체입니다.
 * 초기화 전에는 빈 객체이며, 테마 전환 뒤에도 같은 객체 identity를 유지합니다.
 * 테마의 최상위 속성만 얕게 복사하므로 중첩 값은 registry 값과 동일한 참조입니다.
 * @type {Record<string, *>}
 */
export let ColorSchemes = {};

let themeHandlerInstance = null;

/**
 * 구버전 darkMode boolean 설정을 현재 테마 키로 변환합니다.
 * @param {boolean} isDarkMode - 구버전 다크모드 여부입니다.
 * @returns {string} 현재 테마 레지스트리 키입니다.
 */
const resolveLegacyThemeKey = (isDarkMode) => {
    return isDarkMode ? 'dark' : 'light';
};

/**
 * 테마 키 문자열을 정규화하여 유효한 키를 반환합니다. bool 값은 'dark'/'light'로 변환됩니다.
 * @param {string|boolean} themeKeyOrDarkMode - 테마 키 또는 다크모드 여부
 * @returns {string} 정규화된 테마 키
 */
const normalizeThemeKey = (themeKeyOrDarkMode) => {
    if (typeof themeKeyOrDarkMode === 'boolean') {
        return resolveLegacyThemeKey(themeKeyOrDarkMode);
    }

    if (typeof themeKeyOrDarkMode === 'string'
        && Object.prototype.hasOwnProperty.call(THEMES, themeKeyOrDarkMode)) {
        return themeKeyOrDarkMode;
    }

    return DEFAULT_THEME_KEY;
};

/**
 * 기존 ColorSchemes 객체 identity를 유지한 채 전역 색상 스킴 값을 교체합니다.
 * 기존의 열거 가능한 문자열 키만 삭제하므로 비열거 키와 기존 Symbol 키는 유지되며,
 * 새 테마의 열거 가능한 자체 문자열·Symbol 속성을 얕게 복사합니다.
 * 삭제나 복사 중 발생한 예외는 부분 변경 상태를 유지한 채 전파됩니다.
 * @param {object} theme - 적용할 테마 데이터 객체입니다.
 * @returns {void}
 */
const replaceColorSchemes = (theme) => {
    for (const key of Object.keys(ColorSchemes)) {
        delete ColorSchemes[key];
    }
    Object.assign(ColorSchemes, theme);
};

/**
 * @class ThemeHandler
 * @description 설정된 테마 키에 맞춰 색상 스킴을 적용하고 배경색을 갱신합니다.
 */
export class ThemeHandler {
    /**
     * 새 ThemeHandler를 만들고 module adapter가 위임할 최신 인스턴스로 등록합니다.
     * 등록은 기본 테마 필드 쓰기보다 먼저 일어납니다.
     */
    constructor() {
        themeHandlerInstance = this;

        // 초기화 전 임시로 사용할 기본 테마
        this.currentTheme = DEFAULT_THEME_KEY;
    }

    /**
     * 저장된 설정 파일(settings.json)을 로드하여 초기 테마를 구성합니다.
     * 파일 접근·읽기·파싱 실패는 기본 테마로 복구하지만, 테마 적용 예외는 전파합니다.
     * @returns {Promise<void>}
     */
    async init() {
        let themeKey = DEFAULT_THEME_KEY;
        try {
            const dataDir = path.join(process.cwd(), 'save');
            const settingsPath = path.join(dataDir, 'settings.json');

            try {
                await fsPromises.access(settingsPath);
                const data = JSON.parse(await fsPromises.readFile(settingsPath, 'utf-8'));
                if (typeof data.theme === 'string') {
                    themeKey = data.theme;
                } else if (typeof data.darkMode === 'boolean') {
                    themeKey = resolveLegacyThemeKey(data.darkMode);
                }
            } catch (err) {
                // 파일이 없거나 읽기 에러
            }
        } catch (e) {
            console.error('ThemeHandler: 초기 설정 로드에 실패했습니다:', e);
        }

        this.setTheme(themeKey, false); // WebGL 미초기화 상태이므로 화면 갱신은 안 함
        this.updateBackgroundColor();
    }

    /**
     * 특정 테마 키 혹은 다크모드 여부를 입력받아 현재 색상 스킴을 갱신합니다.
     * @param {string|boolean} themeKeyOrDarkMode 테마 키 ('dark', 'light') 또는 다크모드 여부(true/false)
     * @param {boolean} [updateDisplay=true] 배경색 등 화면 갱신 수행 여부
     * @returns {void}
     */
    setTheme(themeKeyOrDarkMode, updateDisplay = true) {
        const resolvedThemeKey = normalizeThemeKey(themeKeyOrDarkMode);
        this.currentTheme = resolvedThemeKey;

        replaceColorSchemes(getThemeByKey(resolvedThemeKey));

        if (updateDisplay) {
            this.updateBackgroundColor();
        }
    }

    /**
     * 현재 테마의 배경색을 시스템 배경 렌더러에 적용합니다.
     * @returns {void}
     */
    updateBackgroundColor() {
        if (ColorSchemes.Background) {
            const rgb = colorUtil().cssToRgb(ColorSchemes.Background);
            setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }
    }

    /**
     * 현재 적용 중인 테마 식별 키를 반환합니다.
     * @returns {string} 테마 키 문자열
     */
    getCurrentTheme() {
        return this.currentTheme;
    }
}

/**
 * 가장 최근에 생성된 ThemeHandler 인스턴스에 테마를 반영합니다.
 * 인스턴스가 아직 없으면 아무 작업도 하지 않습니다.
 * @param {string|boolean} themeKeyOrDarkMode - 테마 키(예: 'dark') 또는 구버전 bool 값
 * @returns {void}
 */
export const setTheme = (themeKeyOrDarkMode) => {
    if (themeHandlerInstance) {
        themeHandlerInstance.setTheme(themeKeyOrDarkMode);
    }
};

/**
 * 최신 ThemeHandler가 보고한 현재 테마 키를 반환합니다.
 * 인스턴스·메서드가 없거나 반환값이 falsy이면 기본 테마 키로 복구합니다.
 * @returns {string} 현재 테마 키 또는 기본 테마 키입니다.
 */
export const getCurrentThemeKey = () => themeHandlerInstance?.getCurrentTheme?.() || DEFAULT_THEME_KEY;
