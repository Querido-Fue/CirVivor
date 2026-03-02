import { LightTheme, DarkTheme } from 'data/global/color_schemes.js';
import { setBackgroundColor } from 'display/display_system.js';
import { colorUtil } from 'util/color_util.js';
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

export let ColorSchemes = {};

let themeHandlerInstance = null;

/**
 * @class ThemeHandler
 * @description 테마(라이트/다크) 선택과 색상 스킴 반영, 배경색 갱신을 담당합니다.
 */
export class ThemeHandler {
    constructor() {
        themeHandlerInstance = this;

        // 초기화 전 임시로 사용할 기본 테마
        this.currentTheme = 'dark';
    }

    async init() {
        let isDarkMode = true;
        try {
            const dataDir = path.join(process.cwd(), 'save');
            const settingsPath = path.join(dataDir, 'settings.json');

            try {
                await fsPromises.access(settingsPath);
                const data = JSON.parse(await fsPromises.readFile(settingsPath, 'utf-8'));
                if (data.darkMode !== undefined) {
                    isDarkMode = data.darkMode;
                }
            } catch (err) {
                // 파일이 없거나 읽기 에러
            }
        } catch (e) {
            console.error("ThemeHandler failed to load initial settings:", e);
        }

        this.setTheme(isDarkMode, false); // WebGL 미초기화 상태이므로 화면 갱신은 안 함
        this.updateBackgroundColor();
    }

    setTheme(isDarkMode, updateDisplay = true) {
        this.currentTheme = isDarkMode ? 'dark' : 'light';
        if (isDarkMode) {
            Object.assign(ColorSchemes, DarkTheme);
        } else {
            Object.assign(ColorSchemes, LightTheme);
        }

        if (updateDisplay) {
            this.updateBackgroundColor();
        }
    }

    updateBackgroundColor() {
        if (ColorSchemes.Background) {
            const rgb = colorUtil().cssToRgb(ColorSchemes.Background);
            setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }
    }

    getCurrentTheme() {
        return this.currentTheme;
    }
}

/**
 * 현재 ThemeHandler 인스턴스에 테마를 반영합니다.
 * @param {boolean} isDarkMode - 다크 모드 여부
 */
export const setTheme = (isDarkMode) => {
    if (themeHandlerInstance) {
        themeHandlerInstance.setTheme(isDarkMode);
    }
}
