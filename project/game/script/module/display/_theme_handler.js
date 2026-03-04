import { getData } from 'data/data_handler.js';
import { setBackgroundColor } from 'display/display_system.js';
import { colorUtil } from 'util/color_util.js';
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

const THEMES = getData('THEMES');
const DEFAULT_THEME_KEY = getData('DEFAULT_THEME_KEY');
const getThemeByKey = getData('getThemeByKey');

export let ColorSchemes = {};

let themeHandlerInstance = null;

const normalizeThemeKey = (themeKeyOrDarkMode) => {
    if (typeof themeKeyOrDarkMode === 'boolean') {
        return themeKeyOrDarkMode ? 'dark' : 'light';
    }

    if (typeof themeKeyOrDarkMode === 'string'
        && Object.prototype.hasOwnProperty.call(THEMES, themeKeyOrDarkMode)) {
        return themeKeyOrDarkMode;
    }

    return DEFAULT_THEME_KEY;
};

/**
 * @class ThemeHandler
 * @description 설정된 테마 키에 맞춰 색상 스킴을 적용하고 배경색을 갱신합니다.
 */
export class ThemeHandler {
    constructor() {
        themeHandlerInstance = this;

        // 초기화 전 임시로 사용할 기본 테마
        this.currentTheme = DEFAULT_THEME_KEY;
    }

    /**
         * 저장된 설정 파일(settings.json)을 로드하여 초기 테마를 구성합니다.
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
                    themeKey = data.darkMode ? 'dark' : 'light';
                }
            } catch (err) {
                // 파일이 없거나 읽기 에러
            }
        } catch (e) {
            console.error("ThemeHandler failed to load initial settings:", e);
        }

        this.setTheme(themeKey, false); // WebGL 미초기화 상태이므로 화면 갱신은 안 함
        this.updateBackgroundColor();
    }

    /**
         * 특정 테마 키 혹은 다크모드 여부를 입력받아 현재 색상 스킴을 갱신합니다.
         * @param {string|boolean} themeKeyOrDarkMode 테마 키 ('dark', 'light') 또는 다크모드 여부(true/false)
         * @param {boolean} [updateDisplay=true] 배경색 등 화면 갱신 수행 여부
         */
    setTheme(themeKeyOrDarkMode, updateDisplay = true) {
        const resolvedThemeKey = normalizeThemeKey(themeKeyOrDarkMode);
        this.currentTheme = resolvedThemeKey;

        // 이전 테마 잔존 키를 방지하기 위해 먼저 비웁니다.
        for (const key of Object.keys(ColorSchemes)) {
            delete ColorSchemes[key];
        }
        Object.assign(ColorSchemes, getThemeByKey(resolvedThemeKey));

        if (updateDisplay) {
            this.updateBackgroundColor();
        }
    }

    /**
         * 현재 테마의 배경색을 시스템 배경 렌더러에 적용합니다.
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
 * 현재 ThemeHandler 인스턴스에 테마를 반영합니다.
 * @param {string|boolean} themeKeyOrDarkMode - 테마 키(예: 'dark') 또는 구버전 bool 값
 */
export const setTheme = (themeKeyOrDarkMode) => {
    if (themeHandlerInstance) {
        themeHandlerInstance.setTheme(themeKeyOrDarkMode);
    }
}
